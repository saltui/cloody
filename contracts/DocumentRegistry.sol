// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DocumentRegistry
 * @dev M-of-N 다중서명 문서 승인 시스템
 * 파일 해시를 블록체인에 앵커링하여 무결성 검증
 */
contract DocumentRegistry {
    // ============ Structs ============

    struct Document {
        uint256 id;
        bytes32 fileHash;           // SHA-256 해시 (파일 지문)
        string metaData;            // JSON 메타데이터 (제목, 설명 등)
        address uploader;           // 업로드한 사람
        uint256 uploadedAt;         // 업로드 시간
        uint256 requiredApprovals;  // 필요 승인 수 (M of N)
        address[] approvers;        // 승인자 목록
        mapping(address => bool) hasApproved;  // 승인 여부
        mapping(address => string) approvalComments;  // 승인 코멘트
        uint256 approvalCount;      // 현재 승인 수
        bool isFinalized;           // 최종 승인 완료 여부
        uint256 expiresAt;          // 만료 시간
    }

    struct DocumentView {
        uint256 id;
        bytes32 fileHash;
        string metaData;
        address uploader;
        uint256 uploadedAt;
        uint256 requiredApprovals;
        address[] approvers;
        uint256 approvalCount;
        bool isFinalized;
        uint256 expiresAt;
    }

    struct ApprovalRecord {
        address approver;
        uint256 approvedAt;
        string comment;
    }

    // ============ State Variables ============

    uint256 private _documentIdCounter;
    mapping(uint256 => Document) private documents;
    mapping(bytes32 => uint256) public hashToDocumentId;  // 해시로 문서 조회
    mapping(address => uint256[]) private userDocuments;  // 사용자별 문서 목록

    // ============ Events ============

    event DocumentRegistered(
        uint256 indexed documentId,
        bytes32 indexed fileHash,
        address indexed uploader,
        uint256 requiredApprovals
    );

    event DocumentSigned(
        uint256 indexed documentId,
        address indexed signer,
        uint256 approvalCount,
        uint256 requiredApprovals
    );

    event DocumentFinalized(
        uint256 indexed documentId,
        uint256 timestamp
    );

    // ============ Errors ============

    error DocumentNotFound();
    error NotAuthorized();
    error AlreadyApproved();
    error DocumentExpired();
    error DocumentAlreadyFinalized();
    error HashAlreadyRegistered();
    error InvalidApprovers();

    // ============ Main Functions ============

    /**
     * @dev 새 문서 등록
     * @param _fileHash 파일의 SHA-256 해시
     * @param _metaData JSON 메타데이터
     * @param _approvers 승인자 주소 목록
     * @param _requiredApprovals 필요 승인 수 (M of N)
     * @param _expiresIn 만료까지 시간 (초)
     */
    function registerDocument(
        bytes32 _fileHash,
        string calldata _metaData,
        address[] calldata _approvers,
        uint256 _requiredApprovals,
        uint256 _expiresIn
    ) external returns (uint256) {
        // 해시 중복 확인
        if (hashToDocumentId[_fileHash] != 0) {
            revert HashAlreadyRegistered();
        }

        // 승인자 수 검증
        if (_approvers.length == 0 || _requiredApprovals == 0 || _requiredApprovals > _approvers.length) {
            revert InvalidApprovers();
        }

        _documentIdCounter++;
        uint256 newId = _documentIdCounter;

        Document storage doc = documents[newId];
        doc.id = newId;
        doc.fileHash = _fileHash;
        doc.metaData = _metaData;
        doc.uploader = msg.sender;
        doc.uploadedAt = block.timestamp;
        doc.requiredApprovals = _requiredApprovals;
        doc.approvers = _approvers;
        doc.expiresAt = block.timestamp + _expiresIn;

        hashToDocumentId[_fileHash] = newId;
        userDocuments[msg.sender].push(newId);

        // 승인자들의 문서 목록에도 추가
        for (uint256 i = 0; i < _approvers.length; i++) {
            userDocuments[_approvers[i]].push(newId);
        }

        emit DocumentRegistered(newId, _fileHash, msg.sender, _requiredApprovals);

        return newId;
    }

    /**
     * @dev 문서 승인 (서명)
     * @param _documentId 문서 ID
     * @param _comment 승인 코멘트
     */
    function signDocument(uint256 _documentId, string calldata _comment) external {
        Document storage doc = documents[_documentId];

        if (doc.id == 0) revert DocumentNotFound();
        if (doc.isFinalized) revert DocumentAlreadyFinalized();
        if (block.timestamp > doc.expiresAt) revert DocumentExpired();
        if (doc.hasApproved[msg.sender]) revert AlreadyApproved();

        // 승인자인지 확인
        bool isApprover = false;
        for (uint256 i = 0; i < doc.approvers.length; i++) {
            if (doc.approvers[i] == msg.sender) {
                isApprover = true;
                break;
            }
        }
        if (!isApprover) revert NotAuthorized();

        // 승인 기록
        doc.hasApproved[msg.sender] = true;
        doc.approvalComments[msg.sender] = _comment;
        doc.approvalCount++;

        emit DocumentSigned(_documentId, msg.sender, doc.approvalCount, doc.requiredApprovals);

        // M-of-N 달성 시 자동 완료
        if (doc.approvalCount >= doc.requiredApprovals) {
            doc.isFinalized = true;
            emit DocumentFinalized(_documentId, block.timestamp);
        }
    }

    // ============ View Functions ============

    /**
     * @dev 문서 조회
     */
    function getDocument(uint256 _documentId) external view returns (DocumentView memory) {
        Document storage doc = documents[_documentId];
        if (doc.id == 0) revert DocumentNotFound();

        return DocumentView({
            id: doc.id,
            fileHash: doc.fileHash,
            metaData: doc.metaData,
            uploader: doc.uploader,
            uploadedAt: doc.uploadedAt,
            requiredApprovals: doc.requiredApprovals,
            approvers: doc.approvers,
            approvalCount: doc.approvalCount,
            isFinalized: doc.isFinalized,
            expiresAt: doc.expiresAt
        });
    }

    /**
     * @dev 해시로 문서 ID 조회
     */
    function getDocumentIdByHash(bytes32 _fileHash) external view returns (uint256) {
        return hashToDocumentId[_fileHash];
    }

    /**
     * @dev 해시로 문서 조회
     */
    function getDocumentByHash(bytes32 _fileHash) external view returns (DocumentView memory) {
        uint256 docId = hashToDocumentId[_fileHash];
        if (docId == 0) revert DocumentNotFound();

        Document storage doc = documents[docId];
        return DocumentView({
            id: doc.id,
            fileHash: doc.fileHash,
            metaData: doc.metaData,
            uploader: doc.uploader,
            uploadedAt: doc.uploadedAt,
            requiredApprovals: doc.requiredApprovals,
            approvers: doc.approvers,
            approvalCount: doc.approvalCount,
            isFinalized: doc.isFinalized,
            expiresAt: doc.expiresAt
        });
    }

    /**
     * @dev 특정 승인자의 승인 여부 확인
     */
    function hasApproved(uint256 _documentId, address _approver) external view returns (bool) {
        return documents[_documentId].hasApproved[_approver];
    }

    /**
     * @dev 승인 코멘트 조회
     */
    function getApprovalComment(uint256 _documentId, address _approver) external view returns (string memory) {
        return documents[_documentId].approvalComments[_approver];
    }

    /**
     * @dev 사용자의 문서 목록 조회
     */
    function getUserDocuments(address _user) external view returns (uint256[] memory) {
        return userDocuments[_user];
    }

    /**
     * @dev 해시 검증 (파일 무결성 확인)
     */
    function verifyHash(bytes32 _fileHash) external view returns (bool exists, bool isFinalized, uint256 documentId) {
        documentId = hashToDocumentId[_fileHash];
        if (documentId == 0) {
            return (false, false, 0);
        }
        return (true, documents[documentId].isFinalized, documentId);
    }

    /**
     * @dev 총 문서 수
     */
    function totalDocuments() external view returns (uint256) {
        return _documentIdCounter;
    }
}
