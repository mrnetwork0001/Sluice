export const gateAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "sluice_",
        "type": "address",
        "internalType": "contract Sluice"
      },
      {
        "name": "messenger_",
        "type": "address",
        "internalType": "contract MockCCTPMessenger"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "messenger",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract MockCCTPMessenger"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onCCTPHook",
    "inputs": [
      {
        "name": "sourceDomain",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sluice",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Sluice"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usdc",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawToChain",
    "inputs": [
      {
        "name": "streamId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "destinationDomain",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "destRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "CrossChainStreamFunded",
    "inputs": [
      {
        "name": "streamId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "sourceDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "employer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CrossChainStreamPurchased",
    "inputs": [
      {
        "name": "streamId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "sourceDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "refund",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CrossChainWithdrawal",
    "inputs": [
      {
        "name": "streamId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "destinationDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "destRecipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "netAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HookRefunded",
    "inputs": [
      {
        "name": "sourceDomain",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  }
] as const;
