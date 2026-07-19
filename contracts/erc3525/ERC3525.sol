// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal self-contained ERC-3525 Semi-Fungible Token implementation.
/// @notice Each token is an ERC-721-style NFT that additionally carries a fungible
///         `value` inside a `slot`. Value can be transferred between same-slot tokens
///         or split off into a freshly minted token for a new owner.
abstract contract ERC3525 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event TransferValue(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint256 value);
    event ApprovalValue(uint256 indexed tokenId, address indexed operator, uint256 value);
    event SlotChanged(uint256 indexed tokenId, uint256 indexed oldSlot, uint256 indexed newSlot);

    string public name;
    string public symbol;
    uint8 public immutable valueDecimals;

    struct TokenData {
        address owner;
        uint256 slot;
        uint256 value;
    }

    uint256 internal _nextTokenId = 1;
    mapping(uint256 => TokenData) internal _tokens;
    mapping(address => uint256) private _holdings;
    mapping(uint256 => address) private _tokenApproval;
    mapping(address => mapping(address => bool)) private _operatorApproval;
    mapping(uint256 => mapping(address => uint256)) private _valueApproval;

    constructor(string memory name_, string memory symbol_, uint8 valueDecimals_) {
        name = name_;
        symbol = symbol_;
        valueDecimals = valueDecimals_;
    }

    // ---------------------------------------------------------------- views

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _tokens[tokenId].owner;
        require(owner != address(0), "ERC3525: invalid token");
    }

    function balanceOf(address owner) public view returns (uint256) {
        return _holdings[owner];
    }

    /// @notice ERC-3525 value of a token.
    function balanceOf(uint256 tokenId) public view returns (uint256) {
        ownerOf(tokenId);
        return _tokens[tokenId].value;
    }

    function slotOf(uint256 tokenId) public view returns (uint256) {
        ownerOf(tokenId);
        return _tokens[tokenId].slot;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        ownerOf(tokenId);
        return _tokenApproval[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApproval[owner][operator];
    }

    function allowance(uint256 tokenId, address operator) public view returns (uint256) {
        return _valueApproval[tokenId][operator];
    }

    // ------------------------------------------------------ ERC-721 actions

    function approve(address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || _operatorApproval[owner][msg.sender], "ERC3525: not authorized");
        _tokenApproval[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public {
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isAuthorized(msg.sender, tokenId), "ERC3525: not authorized");
        _transferToken(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public {
        transferFrom(from, to, tokenId);
    }

    // ----------------------------------------------------- ERC-3525 actions

    /// @notice Approve `operator` to spend up to `value` from `tokenId`.
    function approve(uint256 tokenId, address operator, uint256 value) public {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || _operatorApproval[owner][msg.sender], "ERC3525: not authorized");
        _valueApproval[tokenId][operator] = value;
        emit ApprovalValue(tokenId, operator, value);
    }

    /// @notice Move `value` between two existing same-slot tokens (merge path).
    function transferFrom(uint256 fromTokenId, uint256 toTokenId, uint256 value) public {
        _spendValueAllowance(msg.sender, fromTokenId, value);
        _transferValue(fromTokenId, toTokenId, value);
    }

    /// @notice Split `value` off `fromTokenId` into a newly minted token owned by `to`.
    function transferFrom(uint256 fromTokenId, address to, uint256 value) public returns (uint256 newTokenId) {
        _spendValueAllowance(msg.sender, fromTokenId, value);
        newTokenId = _createToken(to, _tokens[fromTokenId].slot, 0);
        _transferValue(fromTokenId, newTokenId, value);
    }

    // ------------------------------------------------------------ internals

    function _isAuthorized(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId);
        return spender == owner || spender == _tokenApproval[tokenId] || _operatorApproval[owner][spender];
    }

    function _spendValueAllowance(address spender, uint256 tokenId, uint256 value) internal {
        if (_isAuthorized(spender, tokenId)) return;
        uint256 allowed = _valueApproval[tokenId][spender];
        require(allowed >= value, "ERC3525: insufficient value allowance");
        _valueApproval[tokenId][spender] = allowed - value;
    }

    function _createToken(address to, uint256 slot, uint256 value) internal returns (uint256 tokenId) {
        require(to != address(0), "ERC3525: mint to zero address");
        tokenId = _nextTokenId++;
        _tokens[tokenId] = TokenData({owner: to, slot: slot, value: value});
        _holdings[to] += 1;
        emit Transfer(address(0), to, tokenId);
        emit SlotChanged(tokenId, 0, slot);
        if (value > 0) emit TransferValue(0, tokenId, value);
    }

    function _transferToken(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "ERC3525: transfer from wrong owner");
        require(to != address(0), "ERC3525: transfer to zero address");
        delete _tokenApproval[tokenId];
        _holdings[from] -= 1;
        _holdings[to] += 1;
        _tokens[tokenId].owner = to;
        emit Transfer(from, to, tokenId);
    }

    function _transferValue(uint256 fromTokenId, uint256 toTokenId, uint256 value) internal {
        TokenData storage src = _tokens[fromTokenId];
        TokenData storage dst = _tokens[toTokenId];
        require(src.owner != address(0) && dst.owner != address(0), "ERC3525: invalid token");
        require(src.slot == dst.slot, "ERC3525: slot mismatch");
        require(src.value >= value, "ERC3525: insufficient value");
        _beforeValueTransfer(fromTokenId, toTokenId, value);
        src.value -= value;
        dst.value += value;
        emit TransferValue(fromTokenId, toTokenId, value);
    }

    function _mintValue(uint256 tokenId, uint256 value) internal {
        ownerOf(tokenId);
        _tokens[tokenId].value += value;
        emit TransferValue(0, tokenId, value);
    }

    function _burnValue(uint256 tokenId, uint256 value) internal {
        TokenData storage t = _tokens[tokenId];
        require(t.value >= value, "ERC3525: burn exceeds value");
        t.value -= value;
        emit TransferValue(tokenId, 0, value);
    }

    /// @dev Hook invoked before value moves between tokens; lets implementations
    ///      keep domain accounting (e.g. stream schedules) in sync with SFT value.
    function _beforeValueTransfer(uint256 fromTokenId, uint256 toTokenId, uint256 value) internal virtual {}
}
