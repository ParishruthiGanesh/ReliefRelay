// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SupplyAttestations
 * @notice Append-only, organisation-level acknowledgements of relief supply events.
 *
 * What this contract stores, and nothing more:
 *   - orgRef      an opaque reference for the acknowledging organisation
 *   - subjectRef  an opaque reference for the request being served
 *   - manifestHash  sha256 of an off-chain manifest of the event
 *   - eventType, recordedAt, attester
 *
 * What it deliberately never stores: names, phone numbers, household
 * coordinates, medical information, voice recordings or transcripts. Those
 * live only in the operator's database. The manifest that each hash covers is
 * kept off-chain so it can be shown to a person and explained; the hash exists
 * so two organisations can later agree that an acknowledgement was made and
 * has not been altered.
 *
 * Records are never mutated or deleted. A correction is a new Discrepancy
 * attestation appended after the record it corrects.
 *
 * This preserves an acknowledgement. It is not proof that goods changed hands,
 * and it does not prevent someone acknowledging something untrue.
 */
contract SupplyAttestations {
    enum EventType {
        Commitment,
        Dispatch,
        Receipt,
        Discrepancy
    }

    struct Attestation {
        bytes32 orgRef;
        bytes32 subjectRef;
        bytes32 manifestHash;
        EventType eventType;
        uint64 recordedAt;
        address attester;
    }

    address public admin;

    /// Only registered attesters may append. Each fictional organisation gets
    /// its own development identity so the demonstration shows per-organisation
    /// acknowledgement rather than one shared key.
    mapping(address => bool) public isAttester;
    mapping(address => bytes32) public attesterOrgRef;

    Attestation[] private _attestations;
    mapping(bytes32 => uint256[]) private _bySubject;
    mapping(bytes32 => uint256[]) private _byOrg;

    event AttesterRegistered(address indexed attester, bytes32 indexed orgRef);
    event AttesterRevoked(address indexed attester);
    event AttestationRecorded(
        uint256 indexed index,
        bytes32 indexed orgRef,
        bytes32 indexed subjectRef,
        bytes32 manifestHash,
        EventType eventType,
        uint64 recordedAt,
        address attester
    );

    error NotAdmin();
    error NotAttester();
    error ZeroValue();
    error OrgMismatch();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function registerAttester(address attester, bytes32 orgRef) external onlyAdmin {
        if (attester == address(0) || orgRef == bytes32(0)) revert ZeroValue();
        isAttester[attester] = true;
        attesterOrgRef[attester] = orgRef;
        emit AttesterRegistered(attester, orgRef);
    }

    function revokeAttester(address attester) external onlyAdmin {
        isAttester[attester] = false;
        emit AttesterRevoked(attester);
    }

    /**
     * @notice Appends one acknowledgement.
     * @param orgRef Must match the org reference registered for the caller, so
     *        an organisation cannot acknowledge on another's behalf.
     */
    function record(
        bytes32 orgRef,
        bytes32 subjectRef,
        bytes32 manifestHash,
        EventType eventType
    ) external returns (uint256 index) {
        if (!isAttester[msg.sender]) revert NotAttester();
        if (orgRef == bytes32(0) || subjectRef == bytes32(0) || manifestHash == bytes32(0)) {
            revert ZeroValue();
        }
        if (attesterOrgRef[msg.sender] != orgRef) revert OrgMismatch();

        index = _attestations.length;
        _attestations.push(
            Attestation({
                orgRef: orgRef,
                subjectRef: subjectRef,
                manifestHash: manifestHash,
                eventType: eventType,
                recordedAt: uint64(block.timestamp),
                attester: msg.sender
            })
        );
        _bySubject[subjectRef].push(index);
        _byOrg[orgRef].push(index);

        emit AttestationRecorded(
            index,
            orgRef,
            subjectRef,
            manifestHash,
            eventType,
            uint64(block.timestamp),
            msg.sender
        );
    }

    function total() external view returns (uint256) {
        return _attestations.length;
    }

    function get(uint256 index) external view returns (Attestation memory) {
        return _attestations[index];
    }

    function indicesForSubject(bytes32 subjectRef) external view returns (uint256[] memory) {
        return _bySubject[subjectRef];
    }

    function indicesForOrg(bytes32 orgRef) external view returns (uint256[] memory) {
        return _byOrg[orgRef];
    }

    /// @notice Convenience read used by the app to show a subject's trail.
    function attestationsForSubject(bytes32 subjectRef)
        external
        view
        returns (Attestation[] memory out)
    {
        uint256[] storage indices = _bySubject[subjectRef];
        out = new Attestation[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            out[i] = _attestations[indices[i]];
        }
    }
}
