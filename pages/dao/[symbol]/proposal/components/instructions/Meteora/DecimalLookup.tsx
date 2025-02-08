
import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import Button from '@components/Button';
// Import MintLayout to decode mint accounts from @solana/spl-token
import { MintLayout } from '@solana/spl-token';

const TokenDecimalsLookup: React.FC = () => {
  const { connection } = useConnection();
  const [mintAddress, setMintAddress] = useState('');
  const [decimals, setDecimals] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const lookupDecimals = async () => {
    setLoading(true);
    setError('');
    setDecimals(null);
    try {
      // Validate the mint address
      const mintPubkey = new PublicKey(mintAddress);
      // Fetch the mint account info on-chain
      const accountInfo = await connection.getAccountInfo(mintPubkey);
      if (!accountInfo) {
        setError('Mint account not found.');
        setLoading(false);
        return;
      }
      // Decode the mint account using the MintLayout from @solana/spl-token
      const mintData = MintLayout.decode(accountInfo.data);
      // MintLayout.decimals is a number
      setDecimals(mintData.decimals);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error fetching mint decimals.');
    }
    setLoading(false);
  };

  return (
    <div className="p-4 border rounded-md bg-bkg-2">
      <h3 className="font-bold mb-2">Token Decimals Lookup</h3>
      <input
        type="text"
        className="border rounded p-2 w-full"
        placeholder="Enter token mint address"
        value={mintAddress}
        onChange={(e) => setMintAddress(e.target.value)}
      />
      <Button
        onClick={lookupDecimals}
        disabled={loading || !mintAddress}
        className="mt-2 w-full"
      >
        {loading ? 'Looking up...' : 'Lookup Decimals'}
      </Button>
      {decimals !== null && (
        <div className="mt-2">
          <strong>Decimals:</strong> {decimals}
        </div>
      )}
      {error && <div className="mt-2 text-red-500">{error}</div>}
    </div>
  );
};

export default TokenDecimalsLookup;
