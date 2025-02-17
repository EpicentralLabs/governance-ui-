/**
 * Fetches the pool data for a given DLMM pool address from the Meteora API.
 * 
 * @param dlmmPoolAddress - The address of the DLMM pool to fetch data for.
 * @returns A promise that resolves to an object containing the pool's base token,
 *          quote token, bin step, and bin size.
 *          - `baseToken`: The base token in the pool.
 *          - `quoteToken`: The quote token in the pool.
 *          - `binStep`: The step size for the bin.
 *          - `binSize`: The size of the bin.
 * 
 * @throws Will throw an error if the API request fails or the response is invalid.
 * =========================================================
 *              Developed by the Epicentral Team.
 *              Contributor: @ZeroSums
 * =========================================================
 */ 

export async function fetchPoolData(dlmmPoolAddress: string) {
    const uri = `https://dlmm-api.meteora.ag/pair/${dlmmPoolAddress}`; 
    const response = await fetch(uri);
    
    // Check for a successful response
    if (!response.ok) {
        throw new Error(`Failed to fetch pool data for ${dlmmPoolAddress}`);
    }

    const data = await response.json();
    
    /**
     * Parses the pair string to extract the base and quote tokens.
     * 
     * @param pairs - The pair string, e.g., "USDT-SOL".
     * @returns An object containing the base and quote tokens.
     */
    const parsePairs = (pairs: string) => {
        const [quoteToken, baseToken] = pairs
          .split('-')
          .map((pair: string) => pair.trim());
        return { quoteToken, baseToken };
    };

    const { quoteToken, baseToken } = parsePairs(data.name);
    const binStep = data.binStep;
    const binSize = data.binSize;

    console.log(
      `Updated pool data - baseToken: ${baseToken}, quoteToken: ${quoteToken}, binStep: ${binStep}`
    );

    return { baseToken, quoteToken, binStep, binSize };
}
