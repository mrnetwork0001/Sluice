// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../Sluice.sol";
import {ITokenMessengerV2, CCTPFinality} from "./CCTPInterfaces.sol";
import {SluiceHooks} from "./SluiceGate.sol";

/// @notice A venue the treasury can park idle escrow in. USDC is transferred to
///         the adapter before `deposit` is called.
interface IYieldAdapter {
    function deposit(uint256 amount) external;
    /// @return paid Amount actually sent back to the treasury (0 for async/remote).
    function withdraw(uint256 amount) external returns (uint256 paid);
    function totalAssets() external view returns (uint256);
    function name() external view returns (string memory);
    function apyBps() external view returns (uint256);
    function chainDomain() external view returns (uint32);
    function isRemote() external view returns (bool);
}

/// @notice Fixed-rate vault paying interest in real USDC from a pre-funded
///         reserve — accrual is capped by what the reserve actually holds, so
///         every unit of yield is backed on-chain. Anyone can top the reserve up.
contract ReserveYieldAdapter is IYieldAdapter {
    IERC20 public immutable usdc;
    address public immutable treasury;
    string private _name;
    uint256 private immutable _apyBps;
    uint32 private immutable _domain;

    uint256 public principal;
    uint256 public reserve;
    uint256 public lastAccrued;

    event ReserveFunded(address indexed from, uint256 amount);

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Adapter: only treasury");
        _;
    }

    constructor(IERC20 usdc_, address treasury_, string memory name_, uint256 apyBps_, uint32 domain_) {
        usdc = usdc_;
        treasury = treasury_;
        _name = name_;
        _apyBps = apyBps_;
        _domain = domain_;
        lastAccrued = block.timestamp;
    }

    /// @notice Top up the interest reserve with real USDC.
    function fundReserve(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Adapter: pull failed");
        reserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    function _pendingInterest() internal view returns (uint256) {
        if (principal == 0) return 0;
        uint256 interest = (principal * _apyBps * (block.timestamp - lastAccrued)) / (365 days * 10_000);
        return interest > reserve ? reserve : interest;
    }

    function _accrue() internal {
        uint256 interest = _pendingInterest();
        if (interest > 0) {
            reserve -= interest;
            principal += interest;
        }
        lastAccrued = block.timestamp;
    }

    function deposit(uint256 amount) external onlyTreasury {
        _accrue();
        principal += amount;
    }

    function withdraw(uint256 amount) external onlyTreasury returns (uint256 paid) {
        _accrue();
        paid = amount > principal ? principal : amount;
        principal -= paid;
        require(usdc.transfer(treasury, paid), "Adapter: transfer failed");
    }

    function totalAssets() external view returns (uint256) {
        return principal + _pendingInterest();
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function apyBps() external view returns (uint256) {
        return _apyBps;
    }

    function chainDomain() external view returns (uint32) {
        return _domain;
    }

    function isRemote() external pure returns (bool) {
        return false;
    }
}

/// @notice Cross-chain position: deposits burn USDC over real CCTP v2 into a
///         RemoteYieldVault on another domain; NAV is estimated locally from the
///         vault's APY, and funds come home asynchronously via a hooked return.
contract CCTPRemoteAdapter is IYieldAdapter {
    IERC20 public immutable usdc;
    ITokenMessengerV2 public immutable tokenMessenger;
    address public immutable treasury;
    address public immutable remoteVault;
    /// @notice Only this relayer may deliver the hooked mint on the destination —
    ///         prevents third parties from minting without executing the hook.
    address public immutable relayer;
    uint32 private immutable _destDomain;
    string private _name;
    uint256 private immutable _apyBps;

    uint256 public principalSent;
    uint256 public sentAt;

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Adapter: only treasury");
        _;
    }

    constructor(
        IERC20 usdc_,
        ITokenMessengerV2 tokenMessenger_,
        address treasury_,
        address remoteVault_,
        uint32 destDomain_,
        string memory name_,
        uint256 apyBps_,
        address relayer_
    ) {
        usdc = usdc_;
        tokenMessenger = tokenMessenger_;
        treasury = treasury_;
        remoteVault = remoteVault_;
        _destDomain = destDomain_;
        _name = name_;
        _apyBps = apyBps_;
        relayer = relayer_;
    }

    function deposit(uint256 amount) external onlyTreasury {
        if (principalSent == 0) sentAt = block.timestamp;
        principalSent += amount;
        usdc.approve(address(tokenMessenger), amount);
        // Leaving Arc: standard finality is near-instant and fee-free.
        tokenMessenger.depositForBurnWithHook(
            amount,
            _destDomain,
            bytes32(uint256(uint160(remoteVault))),
            address(usdc),
            bytes32(uint256(uint160(relayer))),
            0,
            CCTPFinality.STANDARD,
            abi.encode(SluiceHooks.REMOTE_DEPOSIT, bytes(""))
        );
    }

    /// @dev Remote liquidity cannot be pulled synchronously — the treasury emits
    ///      RemoteReturnRequested and the relayer triggers the vault's exit.
    function withdraw(uint256) external view onlyTreasury returns (uint256) {
        return 0;
    }

    /// @notice Called by the treasury when hooked funds arrive back from the vault.
    function onReturn(uint256 amount) external onlyTreasury {
        principalSent = amount >= principalSent ? 0 : principalSent - amount;
        if (principalSent == 0) sentAt = 0;
    }

    function totalAssets() external view returns (uint256) {
        if (principalSent == 0) return 0;
        return principalSent + (principalSent * _apyBps * (block.timestamp - sentAt)) / (365 days * 10_000);
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function apyBps() external view returns (uint256) {
        return _apyBps;
    }

    function chainDomain() external view returns (uint32) {
        return _destDomain;
    }

    function isRemote() external pure returns (bool) {
        return true;
    }
}
