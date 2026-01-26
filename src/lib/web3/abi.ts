// DocumentRegistry Contract ABI
// 컨트랙트 배포 후 실제 ABI로 교체 가능

export const DocumentRegistryABI = [
  // Events
  {
    type: 'event',
    name: 'DocumentRegistered',
    inputs: [
      { name: 'documentId', type: 'uint256', indexed: true },
      { name: 'fileHash', type: 'bytes32', indexed: true },
      { name: 'uploader', type: 'address', indexed: true },
      { name: 'requiredApprovals', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DocumentSigned',
    inputs: [
      { name: 'documentId', type: 'uint256', indexed: true },
      { name: 'signer', type: 'address', indexed: true },
      { name: 'approvalCount', type: 'uint256', indexed: false },
      { name: 'requiredApprovals', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DocumentFinalized',
    inputs: [
      { name: 'documentId', type: 'uint256', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },

  // Errors
  { type: 'error', name: 'DocumentNotFound', inputs: [] },
  { type: 'error', name: 'NotAuthorized', inputs: [] },
  { type: 'error', name: 'AlreadyApproved', inputs: [] },
  { type: 'error', name: 'DocumentExpired', inputs: [] },
  { type: 'error', name: 'DocumentAlreadyFinalized', inputs: [] },
  { type: 'error', name: 'HashAlreadyRegistered', inputs: [] },
  { type: 'error', name: 'InvalidApprovers', inputs: [] },

  // Write Functions
  {
    type: 'function',
    name: 'registerDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_fileHash', type: 'bytes32' },
      { name: '_metaData', type: 'string' },
      { name: '_approvers', type: 'address[]' },
      { name: '_requiredApprovals', type: 'uint256' },
      { name: '_expiresIn', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'signDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_documentId', type: 'uint256' },
      { name: '_comment', type: 'string' },
    ],
    outputs: [],
  },

  // Read Functions
  {
    type: 'function',
    name: 'getDocument',
    stateMutability: 'view',
    inputs: [{ name: '_documentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'fileHash', type: 'bytes32' },
          { name: 'metaData', type: 'string' },
          { name: 'uploader', type: 'address' },
          { name: 'uploadedAt', type: 'uint256' },
          { name: 'requiredApprovals', type: 'uint256' },
          { name: 'approvers', type: 'address[]' },
          { name: 'approvalCount', type: 'uint256' },
          { name: 'isFinalized', type: 'bool' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getDocumentIdByHash',
    stateMutability: 'view',
    inputs: [{ name: '_fileHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getDocumentByHash',
    stateMutability: 'view',
    inputs: [{ name: '_fileHash', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'fileHash', type: 'bytes32' },
          { name: 'metaData', type: 'string' },
          { name: 'uploader', type: 'address' },
          { name: 'uploadedAt', type: 'uint256' },
          { name: 'requiredApprovals', type: 'uint256' },
          { name: 'approvers', type: 'address[]' },
          { name: 'approvalCount', type: 'uint256' },
          { name: 'isFinalized', type: 'bool' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'hasApproved',
    stateMutability: 'view',
    inputs: [
      { name: '_documentId', type: 'uint256' },
      { name: '_approver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getApprovalComment',
    stateMutability: 'view',
    inputs: [
      { name: '_documentId', type: 'uint256' },
      { name: '_approver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getUserDocuments',
    stateMutability: 'view',
    inputs: [{ name: '_user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'verifyHash',
    stateMutability: 'view',
    inputs: [{ name: '_fileHash', type: 'bytes32' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'isFinalized', type: 'bool' },
      { name: 'documentId', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'totalDocuments',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'hashToDocumentId',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
