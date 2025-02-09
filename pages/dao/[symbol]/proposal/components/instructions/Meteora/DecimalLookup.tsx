import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import Button from '@components/Button';
// Import MintLayout to decode mint accounts from @solana/spl-token
import { MintLayout } from '@solana/spl-token';

/**
 * A React component to look up the decimals for a specific token mint address.
 * The component allows the user to input a token mint address, fetches the account info from the Solana blockchain,
 * decodes it using the `MintLayout` from `@solana/spl-token`, and displays the token's decimal precision.
 * 
 * @returns {JSX.Element} The TokenDecimalsLookup component for looking up token decimals.
 */
const TokenDecimalsLookup: React.FC = () => {
  const { connection } = useConnection();
  const [mintAddress, setMintAddress] = useState<string>('');
  const [decimals, setDecimals] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * Fetches the decimal precision for the provided token mint address.
   * It validates the address, queries the Solana blockchain for the mint account,
   * and decodes the account data to extract the decimals using `MintLayout`.
   * If an error occurs or the mint address is invalid, an error message will be displayed.
   */
  const lookupDecimals = async (): Promise<void> => {
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
