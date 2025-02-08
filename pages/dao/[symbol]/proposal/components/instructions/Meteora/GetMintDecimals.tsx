import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

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
