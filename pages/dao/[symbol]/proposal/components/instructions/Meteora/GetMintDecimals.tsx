import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

/**
 * Fetches the decimals for a specific mint address on the Solana blockchain.
 * It queries the account information for the provided mint address and extracts the decimals.
 * If the mint's decimals cannot be fetched, it defaults to 6 decimals.
 * 
 * @param {string} mintAddress - The mint address (as a string) for which to fetch the decimals.
 * 
 * @returns {Promise<number>} A promise that resolves to the decimals of the mint.
 *         If an error occurs or the decimals cannot be determined, it defaults to 6 decimals.
 */
export async function getMintDecimals(mintAddress: string): Promise<number> {
  const { connection } = useConnection();
  console.log(`Fetching mint decimals for: ${mintAddress}`);
  try {
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));

    if (mintInfo?.value?.data && 'parsed' in mintInfo.value.data && 'info' in mintInfo.value.data.parsed) {
      console.log(`Mint info fetched successfully: ${JSON.stringify(mintInfo.value.data.parsed)}`);
      return mintInfo.value.data.parsed.info.decimals ?? 6;
    }

    console.log('No parsed data found for mint. Defaulting to 6 decimals.');
    return 6;
  } catch (error) {
    console.error('Error fetching mint decimals:', error);
    return 6;
  }
}
