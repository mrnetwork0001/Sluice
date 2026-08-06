// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC3525} from "./erc3525/ERC3525.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISluiceTreasury {
    function notifyDeposit(uint256 amount) external;
    function recall(uint256 amount) external;
}

/// @title Sluice — USDC payroll streaming on Arc L1
/// @notice Every salary stream is an ERC-3525 semi-fungible token whose value is the
///         remaining streamable USDC. Streams vest per-second, apply an automatic tax
///         split on withdrawal, can be split/merged/transferred, sold at a discount on
///         a P2P marketplace, borrowed against (salary advance, ≤50%), and insured
///         against employer default via a staked credit-default pool.
contract Sluice is ERC3525 {
    /// @dev Native USDC on Arc Testnet (also the gas token).
    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    uint256 public constant BPS = 10_000;
    uint256 public constant INSURANCE_PREMIUM_BPS = 50; // 0.5%
    uint256 public constant MAX_ADVANCE_BPS = 5_000; // 50% of remaining value

    IERC20 public immutable usdc;

    struct Stream {
        address employer;
        uint64 start;
        uint64 duration;
        uint256 deposit; // total scheduled USDC (6 decimals)
        uint256 ratePerSecond;
        uint256 withdrawn;
        uint256 advanced; // outstanding salary advance, repaid from future vesting
        uint16 taxBps;
        address taxVault;
        bool insured;
        bool canceled;
        uint256 salePrice; // 0 = not listed
        uint256 shortfall; // claimable insurance coverage after employer default
    }

    mapping(uint256 => Stream) public streams;

    // Credit-default insurance pool (share-based so premiums accrue to stakers).
    uint256 public poolBalance;
    uint256 public totalPoolShares;
    mapping(address => uint256) public poolShares;

    // Cross-chain gate (CCTP entry/exit) and idle-escrow yield treasury.
    address public gate;
    address public treasury;
    /// @dev Sum of remaining stream value across all live streams. Together with
    ///      poolBalance this is the contract's USDC obligation, bounding sweeps.
    uint256 public escrowLiability;
    /// @notice Share of obligations always kept liquid here for withdrawals (40%).
    uint256 public constant BUFFER_BPS = 4_000;

    // ---- lifetime protocol metrics (monotonic; survive stream settlement) ----
    /// @notice Total USDC ever escrowed into salary streams.
    uint256 public totalEscrowed;
    /// @notice Total USDC ever settled out to employees (withdrawals + advances
    ///         + payouts on cancellation), inclusive of the tax share.
    uint256 public totalSettled;
    /// @notice Total USDC ever routed to tax vaults.
    uint256 public totalTaxWithheld;
    /// @notice Number of streams ever opened.
    uint256 public totalStreams;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed employer,
        address indexed recipient,
        uint256 amount,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    );
    event StreamWithdrawal(uint256 indexed streamId, address indexed to, uint256 amount, uint256 tax);
    event StreamListed(uint256 indexed streamId, address indexed seller, uint256 salePrice);
    event StreamSold(uint256 indexed streamId, address indexed seller, address indexed buyer, uint256 salePrice);
    event SalaryAdvance(uint256 indexed streamId, address indexed to, uint256 amount);
    event StreamInsured(uint256 indexed streamId, uint256 premium);
    event StreamCanceled(uint256 indexed streamId, uint256 paidOut, uint256 refunded, uint256 shortfall);
    event InsuranceStaked(address indexed staker, uint256 amount, uint256 shares);
    event InsuranceUnstaked(address indexed staker, uint256 amount, uint256 shares);
    event DefaultCoverageClaimed(uint256 indexed streamId, address indexed to, uint256 amount);
    event PayrollRun(address indexed employer, uint256 streamCount, uint256[] streamIds);
    event StreamToppedUp(uint256 indexed streamId, address indexed employer, uint256 amount, uint64 newDuration);
    event EscrowSwept(uint256 amount);
    event EscrowRecalled(uint256 amount);

    /// @param usdc_ USDC token address; pass address(0) to use the Arc testnet address.
    constructor(address usdc_) ERC3525("Sluice Salary Stream", "SLUICE", 6) {
        usdc = IERC20(usdc_ == address(0) ? ARC_USDC : usdc_);
    }

    /// @notice One-time wiring of the cross-chain gate (deploy-time).
    function setGate(address gate_) external {
        require(gate == address(0) && gate_ != address(0), "Sluice: gate set");
        gate = gate_;
    }

    /// @notice One-time wiring of the yield treasury (deploy-time).
    function setTreasury(address treasury_) external {
        require(treasury == address(0) && treasury_ != address(0), "Sluice: treasury set");
        treasury = treasury_;
    }

    // ------------------------------------------------------------- streaming

    /// @notice Escrow `amount` USDC and mint a stream SFT to `recipient`, vesting
    ///         per-second over `durationSeconds`. `taxBps` of every withdrawal is
    ///         routed to `taxVault`. Slot = employer address, so an employer's
    ///         streams can be split and merged among each other.
    function createStream(address recipient, uint256 amount, uint256 durationSeconds, uint256 taxBps, address taxVault)
        external
        returns (uint256 streamId)
    {
        return _createStream(msg.sender, msg.sender, recipient, amount, durationSeconds, taxBps, taxVault);
    }

    /// @notice Gate-only variant for cross-chain funding: USDC is pulled from the
    ///         gate (just minted by CCTP) while `employer` keeps cancel rights.
    function createStreamFor(
        address employer,
        address recipient,
        uint256 amount,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    ) external returns (uint256 streamId) {
        require(msg.sender == gate, "Sluice: only gate");
        return _createStream(employer, msg.sender, recipient, amount, durationSeconds, taxBps, taxVault);
    }

    function _createStream(
        address employer,
        address funder,
        address recipient,
        uint256 amount,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    ) internal returns (uint256 streamId) {
        require(employer != address(0), "Sluice: employer zero");
        require(recipient != address(0), "Sluice: recipient zero");
        require(amount > 0, "Sluice: amount zero");
        require(durationSeconds > 0 && durationSeconds <= type(uint64).max, "Sluice: bad duration");
        require(taxBps <= BPS, "Sluice: tax > 100%");
        require(taxBps == 0 || taxVault != address(0), "Sluice: tax vault zero");

        _pull(funder, amount);
        escrowLiability += amount;
        totalEscrowed += amount;
        totalStreams += 1;
        streamId = _createToken(recipient, uint256(uint160(employer)), amount);
        streams[streamId] = Stream({
            employer: employer,
            start: uint64(block.timestamp),
            duration: uint64(durationSeconds),
            deposit: amount,
            ratePerSecond: amount / durationSeconds,
            withdrawn: 0,
            advanced: 0,
            taxBps: uint16(taxBps),
            taxVault: taxVault,
            insured: false,
            canceled: false,
            salePrice: 0,
            shortfall: 0
        });
        emit StreamCreated(streamId, employer, recipient, amount, durationSeconds, taxBps, taxVault);
    }

    /// @notice Open many streams in one transaction — a payroll run.
    /// @dev Arrays are parallel; one USDC pull covers the whole batch. Reverts
    ///      atomically, so a bad row never leaves a half-executed payroll.
    function createStreamBatch(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    ) external returns (uint256[] memory streamIds) {
        uint256 count = recipients.length;
        require(count > 0, "Sluice: empty batch");
        require(count == amounts.length, "Sluice: length mismatch");

        streamIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            streamIds[i] =
                _createStream(msg.sender, msg.sender, recipients[i], amounts[i], durationSeconds, taxBps, taxVault);
        }
        emit PayrollRun(msg.sender, count, streamIds);
    }

    /// @notice Gate-only payroll run funded by a cross-chain mint: `amount` is
    ///         split across recipients by basis points.
    /// @dev Percentages rather than fixed amounts because CCTP deducts a transfer
    ///      fee — the exact arriving amount is unknowable when the burn is signed,
    ///      but a split always applies cleanly. The last recipient absorbs the
    ///      rounding dust so the run allocates the mint exactly.
    function createStreamBatchFor(
        address employer,
        address[] calldata recipients,
        uint256[] calldata shareBps,
        uint256 amount,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    ) external returns (uint256[] memory streamIds) {
        require(msg.sender == gate, "Sluice: only gate");
        uint256 count = recipients.length;
        require(count > 0, "Sluice: empty batch");
        require(count == shareBps.length, "Sluice: length mismatch");

        uint256 totalBps;
        for (uint256 i = 0; i < count; i++) {
            totalBps += shareBps[i];
        }
        require(totalBps == BPS, "Sluice: shares must total 100%");

        streamIds = new uint256[](count);
        uint256 allocated;
        for (uint256 i = 0; i < count; i++) {
            uint256 share = i == count - 1 ? amount - allocated : (amount * shareBps[i]) / BPS;
            allocated += share;
            streamIds[i] = _createStream(employer, msg.sender, recipients[i], share, durationSeconds, taxBps, taxVault);
        }
        emit PayrollRun(employer, count, streamIds);
    }

    /// @notice Gate-only payroll run with EXACT per-employee amounts, funded by a
    ///         cross-chain mint. The gate burns with fee headroom and refunds any
    ///         surplus, so exact-amount payroll works cross-chain too.
    function createStreamBatchExactFor(
        address employer,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 durationSeconds,
        uint256 taxBps,
        address taxVault
    ) external returns (uint256[] memory streamIds) {
        require(msg.sender == gate, "Sluice: only gate");
        uint256 count = recipients.length;
        require(count > 0, "Sluice: empty batch");
        require(count == amounts.length, "Sluice: length mismatch");

        streamIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            streamIds[i] =
                _createStream(employer, msg.sender, recipients[i], amounts[i], durationSeconds, taxBps, taxVault);
        }
        emit PayrollRun(employer, count, streamIds);
    }

    /// @notice Extend a live stream with more USDC — recurring payroll without
    ///         re-onboarding the employee. The rate is preserved and the end date
    ///         moves out by `amount / ratePerSecond`.
    function topUpStream(uint256 streamId, uint256 amount) external {
        Stream storage s = streams[streamId];
        require(msg.sender == s.employer, "Sluice: only employer");
        require(!s.canceled, "Sluice: canceled");
        require(amount > 0, "Sluice: amount zero");
        require(s.ratePerSecond > 0, "Sluice: zero rate");

        uint256 addedSeconds = amount / s.ratePerSecond;
        require(addedSeconds > 0, "Sluice: top-up below one second");
        // Only the exact multiple of the rate is credited so vesting stays exact.
        uint256 credited = addedSeconds * s.ratePerSecond;

        _pull(msg.sender, credited);
        escrowLiability += credited;
        s.deposit += credited;
        s.duration += uint64(addedSeconds);
        _mintValue(streamId, credited);
        emit StreamToppedUp(streamId, msg.sender, credited, s.duration);
    }

    /// @notice USDC vested so far (capped at the scheduled deposit).
    function vestedAmount(uint256 streamId) public view returns (uint256) {
        Stream storage s = streams[streamId];
        if (block.timestamp <= s.start) return 0;
        uint256 elapsed = block.timestamp - s.start;
        if (elapsed >= s.duration) return s.deposit;
        uint256 vested = s.ratePerSecond * elapsed;
        return vested > s.deposit ? s.deposit : vested;
    }

    /// @notice Vested USDC not yet consumed by withdrawals or salary advances.
    function availableToWithdraw(uint256 streamId) public view returns (uint256) {
        Stream storage s = streams[streamId];
        if (s.canceled) return 0;
        uint256 vested = vestedAmount(streamId);
        uint256 spent = s.withdrawn + s.advanced;
        return vested > spent ? vested - spent : 0;
    }

    /// @notice Remaining streamable USDC — always equals the SFT value balanceOf(streamId).
    function remainingValue(uint256 streamId) public view returns (uint256) {
        Stream storage s = streams[streamId];
        return s.deposit - s.withdrawn - s.advanced;
    }

    /// @notice Withdraw vested USDC; `taxBps` is split to the tax vault automatically.
    function withdrawFromStream(uint256 streamId, uint256 amount) external {
        require(_isAuthorized(msg.sender, streamId), "Sluice: not authorized");
        _executeWithdraw(streamId, amount, address(0));
    }

    /// @notice Gate-only: withdraw on behalf of `owner`, paying the net amount to the
    ///         gate so it can burn the funds to the owner's chosen destination chain.
    function withdrawFromStreamFor(address owner, uint256 streamId, uint256 amount) external returns (uint256 net) {
        require(msg.sender == gate, "Sluice: only gate");
        require(owner == ownerOf(streamId), "Sluice: not owner");
        return _executeWithdraw(streamId, amount, gate);
    }

    /// @dev Shared withdrawal path; `sink` == address(0) pays the stream owner.
    function _executeWithdraw(uint256 streamId, uint256 amount, address sink) internal returns (uint256 net) {
        Stream storage s = streams[streamId];
        require(!s.canceled, "Sluice: canceled");
        require(amount > 0 && amount <= availableToWithdraw(streamId), "Sluice: exceeds available");

        address owner = ownerOf(streamId);
        s.withdrawn += amount;
        escrowLiability -= amount;
        _burnValue(streamId, amount);

        uint256 tax = (amount * s.taxBps) / BPS;
        net = amount - tax;
        totalSettled += amount;
        totalTaxWithheld += tax;
        if (tax > 0) _push(s.taxVault, tax);
        _push(sink == address(0) ? owner : sink, net);
        emit StreamWithdrawal(streamId, owner, amount, tax);
    }

    /// @notice Employer cancels a stream: vested-but-unwithdrawn USDC is paid to the
    ///         employee (tax applied), the unvested remainder refunds to the employer.
    ///         For insured streams the lost remainder becomes claimable coverage.
    function cancelStream(uint256 streamId) external {
        Stream storage s = streams[streamId];
        require(msg.sender == s.employer, "Sluice: only employer");
        require(!s.canceled, "Sluice: canceled");

        address owner = ownerOf(streamId);
        uint256 vested = vestedAmount(streamId);
        uint256 spent = s.withdrawn + s.advanced;
        uint256 owed = vested > spent ? vested - spent : 0;
        uint256 refund = s.deposit - spent - owed;

        s.canceled = true;
        s.salePrice = 0;
        s.withdrawn += owed;
        escrowLiability -= owed + refund;
        if (s.insured) s.shortfall = refund;
        _burnValue(streamId, balanceOf(streamId));

        if (owed > 0) {
            uint256 tax = (owed * s.taxBps) / BPS;
            totalSettled += owed;
            totalTaxWithheld += tax;
            if (tax > 0) _push(s.taxVault, tax);
            _push(owner, owed - tax);
        }
        if (refund > 0) _push(s.employer, refund);
        emit StreamCanceled(streamId, owed, refund, s.shortfall);
    }

    // ----------------------------------------------- P2P discount marketplace

    /// @notice List the stream SFT for sale at `salePrice` USDC (0 delists).
    function listStreamForSale(uint256 streamId, uint256 salePrice) external {
        require(msg.sender == ownerOf(streamId), "Sluice: only owner");
        Stream storage s = streams[streamId];
        require(!s.canceled, "Sluice: canceled");
        require(salePrice == 0 || remainingValue(streamId) > 0, "Sluice: empty stream");
        s.salePrice = salePrice;
        emit StreamListed(streamId, msg.sender, salePrice);
    }

    /// @notice Buy a listed stream: pay the seller the discounted price, receive the SFT.
    function buyStream(uint256 streamId) external {
        _executeBuy(msg.sender, msg.sender, streamId);
    }

    /// @notice Gate-only: settle a purchase initiated on another chain — the gate pays
    ///         with CCTP-minted USDC and the SFT lands in the remote buyer's wallet.
    function buyStreamFor(address buyer, uint256 streamId) external {
        require(msg.sender == gate, "Sluice: only gate");
        _executeBuy(buyer, msg.sender, streamId);
    }

    /// @notice Current asking price of a listing (0 = not listed).
    function salePriceOf(uint256 streamId) external view returns (uint256) {
        return streams[streamId].salePrice;
    }

    function _executeBuy(address buyer, address payer, uint256 streamId) internal {
        Stream storage s = streams[streamId];
        uint256 price = s.salePrice;
        require(price > 0, "Sluice: not listed");
        address seller = ownerOf(streamId);
        require(buyer != seller, "Sluice: self purchase");

        s.salePrice = 0;
        require(usdc.transferFrom(payer, seller, price), "Sluice: payment failed");
        _transferToken(seller, buyer, streamId);
        emit StreamSold(streamId, seller, buyer, price);
    }

    // ---------------------------------------------------------- salary advance

    /// @notice Borrow against future salary; cumulative advances are capped at 50% of
    ///         the not-yet-withdrawn stream value and repay implicitly as vesting accrues.
    function borrowSalaryAdvance(uint256 streamId, uint256 advanceAmount) external {
        require(msg.sender == ownerOf(streamId), "Sluice: only owner");
        Stream storage s = streams[streamId];
        require(!s.canceled, "Sluice: canceled");
        require(advanceAmount > 0, "Sluice: amount zero");
        uint256 maxAdvance = ((s.deposit - s.withdrawn) * MAX_ADVANCE_BPS) / BPS;
        require(s.advanced + advanceAmount <= maxAdvance, "Sluice: advance > 50%");

        s.advanced += advanceAmount;
        escrowLiability -= advanceAmount;
        totalSettled += advanceAmount;
        _burnValue(streamId, advanceAmount);
        _push(msg.sender, advanceAmount);
        emit SalaryAdvance(streamId, msg.sender, advanceAmount);
    }

    // ------------------------------------------------- credit default insurance

    /// @notice Employee pays a 0.5% premium on remaining value into the pool to insure
    ///         the stream against employer default (cancellation before full vesting).
    function insureStream(uint256 streamId) external {
        require(msg.sender == ownerOf(streamId), "Sluice: only owner");
        Stream storage s = streams[streamId];
        require(!s.canceled, "Sluice: canceled");
        require(!s.insured, "Sluice: already insured");
        uint256 premium = (remainingValue(streamId) * INSURANCE_PREMIUM_BPS) / BPS;
        require(premium > 0, "Sluice: stream too small");

        _pull(msg.sender, premium);
        poolBalance += premium;
        s.insured = true;
        emit StreamInsured(streamId, premium);
    }

    /// @notice Stake USDC into the insurance pool; shares accrue premium income.
    function stakeInsurancePool(uint256 amount) external {
        require(amount > 0, "Sluice: amount zero");
        _pull(msg.sender, amount);
        uint256 shares = (totalPoolShares == 0 || poolBalance == 0) ? amount : (amount * totalPoolShares) / poolBalance;
        poolShares[msg.sender] += shares;
        totalPoolShares += shares;
        poolBalance += amount;
        emit InsuranceStaked(msg.sender, amount, shares);
    }

    /// @notice Redeem pool shares for the pro-rata USDC balance.
    function unstakeInsurancePool(uint256 shares) external {
        require(shares > 0 && shares <= poolShares[msg.sender], "Sluice: bad shares");
        uint256 amount = (shares * poolBalance) / totalPoolShares;
        poolShares[msg.sender] -= shares;
        totalPoolShares -= shares;
        poolBalance -= amount;
        _push(msg.sender, amount);
        emit InsuranceUnstaked(msg.sender, amount, shares);
    }

    /// @notice After an employer default, the insured stream owner claims the unvested
    ///         shortfall from the pool (capped by pool balance).
    function claimDefaultCoverage(uint256 streamId) external {
        require(msg.sender == ownerOf(streamId), "Sluice: only owner");
        Stream storage s = streams[streamId];
        require(s.canceled && s.insured, "Sluice: no default");
        require(s.shortfall > 0, "Sluice: nothing to claim");

        uint256 pay = s.shortfall <= poolBalance ? s.shortfall : poolBalance;
        require(pay > 0, "Sluice: pool empty");
        s.shortfall -= pay;
        poolBalance -= pay;
        _push(msg.sender, pay);
        emit DefaultCoverageClaimed(streamId, msg.sender, pay);
    }

    // -------------------------------------------------------- split & merge hook

    /// @dev Keeps stream accounting in sync when SFT value is split into a new token
    ///      or merged into an existing same-slot token. Child streams inherit the
    ///      parent's schedule pro-rata so vesting math stays exact.
    function _beforeValueTransfer(uint256 fromTokenId, uint256 toTokenId, uint256 value) internal override {
        Stream storage s = streams[fromTokenId];
        if (s.deposit == 0) return;
        require(!s.canceled, "Sluice: canceled");
        require(s.salePrice == 0, "Sluice: delist first");

        uint256 remaining = s.deposit - s.withdrawn - s.advanced;
        uint256 childWithdrawn = (s.withdrawn * value) / remaining;
        uint256 childAdvanced = (s.advanced * value) / remaining;
        uint256 childRate = (s.ratePerSecond * value) / remaining;
        uint256 childDeposit = childWithdrawn + childAdvanced + value;

        Stream storage t = streams[toTokenId];
        if (t.deposit == 0) {
            streams[toTokenId] = Stream({
                employer: s.employer,
                start: s.start,
                duration: s.duration,
                deposit: childDeposit,
                ratePerSecond: childRate,
                withdrawn: childWithdrawn,
                advanced: childAdvanced,
                taxBps: s.taxBps,
                taxVault: s.taxVault,
                insured: s.insured,
                canceled: false,
                salePrice: 0,
                shortfall: 0
            });
        } else {
            require(
                !t.canceled && t.employer == s.employer && t.start == s.start && t.duration == s.duration
                    && t.taxBps == s.taxBps && t.taxVault == s.taxVault,
                "Sluice: incompatible streams"
            );
            t.deposit += childDeposit;
            t.ratePerSecond += childRate;
            t.withdrawn += childWithdrawn;
            t.advanced += childAdvanced;
        }

        s.deposit -= childDeposit;
        s.withdrawn -= childWithdrawn;
        s.advanced -= childAdvanced;
        s.ratePerSecond -= childRate;
    }

    // ------------------------------------------------------- treasury routing

    /// @notice USDC obligations backing streams and the insurance pool.
    function totalLiability() public view returns (uint256) {
        return escrowLiability + poolBalance;
    }

    /// @notice Escrow that can safely leave for the yield treasury while keeping a
    ///         BUFFER_BPS liquidity buffer for withdrawals.
    function sweepableAmount() public view returns (uint256) {
        uint256 buffer = (totalLiability() * BUFFER_BPS) / BPS;
        uint256 held = usdc.balanceOf(address(this));
        return held > buffer ? held - buffer : 0;
    }

    /// @notice Push idle escrow into the treasury to earn yield. Callable by anyone;
    ///         the liquidity buffer bound makes it safe.
    function sweepIdle() external returns (uint256 amount) {
        require(treasury != address(0), "Sluice: no treasury");
        amount = sweepableAmount();
        require(amount > 0, "Sluice: nothing to sweep");
        require(usdc.transfer(treasury, amount), "Sluice: transfer failed");
        ISluiceTreasury(treasury).notifyDeposit(amount);
        emit EscrowSwept(amount);
    }

    // ---------------------------------------------------------------- helpers

    function _pull(address from, uint256 amount) internal {
        require(usdc.transferFrom(from, address(this), amount), "Sluice: transferFrom failed");
    }

    /// @dev Pays out USDC, automatically recalling liquidity from the treasury when
    ///      the local buffer cannot cover the payment.
    function _push(address to, uint256 amount) internal {
        uint256 held = usdc.balanceOf(address(this));
        if (held < amount && treasury != address(0)) {
            ISluiceTreasury(treasury).recall(amount - held);
            emit EscrowRecalled(amount - held);
        }
        require(usdc.transfer(to, amount), "Sluice: transfer failed");
    }
}
