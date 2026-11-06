// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC165 {
  function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
  function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract ReadingVerifier is IReceiver {
  struct Verification {
    bytes32 evidenceHash;
    uint8 status;
    uint32 findingCount;
    uint64 recordedAt;
    bool exists;
  }

  address public owner;
  address public forwarder;
  bytes32 public latestReportId;
  mapping(bytes32 reportId => Verification) public verifications;

  error Unauthorized(address caller);
  error NotOwner(address caller);
  error InvalidAddress();
  error InvalidReportStatus(uint8 status);
  error ReportConflict(bytes32 reportId);

  event ForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);
  event VerificationStored(
    bytes32 indexed reportId,
    bytes32 indexed evidenceHash,
    uint8 status,
    uint32 findingCount,
    uint64 recordedAt
  );

  constructor(address authorizedForwarder) {
    if (authorizedForwarder == address(0)) revert InvalidAddress();
    owner = msg.sender;
    forwarder = authorizedForwarder;
    emit ForwarderUpdated(address(0), authorizedForwarder);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert NotOwner(msg.sender);
    _;
  }

  function setForwarderAddress(address authorizedForwarder) external onlyOwner {
    if (authorizedForwarder == address(0)) revert InvalidAddress();
    address previous = forwarder;
    forwarder = authorizedForwarder;
    emit ForwarderUpdated(previous, authorizedForwarder);
  }

  function onReport(bytes calldata, bytes calldata report) external override {
    if (msg.sender != forwarder) revert Unauthorized(msg.sender);
    (
      bytes32 reportId,
      bytes32 evidenceHash,
      uint8 status,
      uint32 findingCount
    ) = abi.decode(report, (bytes32, bytes32, uint8, uint32));
    if (status > 2) revert InvalidReportStatus(status);

    Verification storage existing = verifications[reportId];
    if (existing.exists) {
      if (
        existing.evidenceHash != evidenceHash ||
        existing.status != status ||
        existing.findingCount != findingCount
      ) {
        revert ReportConflict(reportId);
      }
      return;
    }

    uint64 recordedAt = uint64(block.timestamp);
    verifications[reportId] = Verification({
      evidenceHash: evidenceHash,
      status: status,
      findingCount: findingCount,
      recordedAt: recordedAt,
      exists: true
    });
    latestReportId = reportId;
    emit VerificationStored(reportId, evidenceHash, status, findingCount, recordedAt);
  }

  function getVerification(
    bytes32 reportId
  ) external view returns (
    bool exists,
    bytes32 evidenceHash,
    uint8 status,
    uint32 findingCount,
    uint64 recordedAt
  ) {
    Verification memory verification = verifications[reportId];
    return (
      verification.exists,
      verification.evidenceHash,
      verification.status,
      verification.findingCount,
      verification.recordedAt
    );
  }

  function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
    return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
  }
}
