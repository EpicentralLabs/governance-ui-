import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { Governance, ProgramAccount } from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { NewProposalContext } from '../../../new';
import InstructionForm, { InstructionInput } from '../FormCreator';
import { InstructionInputType } from '../inputInstructionType';
import { AssetAccount } from '@utils/uiTypes/assets';
import useWalletOnePointOh from '@hooks/useWalletOnePointOh';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import { useConnection } from '@solana/wallet-adapter-react';
import { sendAndConfirmTransaction, PublicKey } from '@solana/web3.js'; 
import BN from 'bn.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';

/**
 * Options for liquidity strategies used in the pool creation.
 */
const strategyOptions = [
  { name: 'Spot Balanced', value: StrategyType.SpotBalanced },
  { name: 'Curve Balanced', value: StrategyType.CurveBalanced },
  { name: 'BidAsk Balanced', value: StrategyType.BidAskBalanced },
  { name: 'Spot Imbalanced', value: StrategyType.SpotImBalanced },
  { name: 'Curve Imbalanced', value: StrategyType.CurveImBalanced },
  { name: 'BidAsk Imbalanced', value: StrategyType.BidAskImBalanced },
  { name: 'Spot OneSide', value: StrategyType.SpotOneSide },
  { name: 'Curve OneSide', value: StrategyType.CurveOneSide },
  { name: 'BidAsk OneSide', value: StrategyType.BidAskOneSide },
];

/**
 * Component for creating a liquidity pool on Solana using DLMM and governance features.
 *
 * @param {Object} props - The component props.
 * @param {number} props.index - The index for this liquidity pool form in the parent component.
 * @param {ProgramAccount<Governance> | null} props.governance - The governance account associated with this pool.
 *
 * @returns {JSX.Element} - The rendered CreateLiquidityPool form.
 */
const CreateLiquidityPool = ({
  index,
  governance,
}: {
  index: number;
  governance: ProgramAccount<Governance> | null;
}) => {
  const { assetAccounts } = useGovernanceAssets();
  const wallet = useWalletOnePointOh();
  const connected = !!wallet?.connected;
  const { connection } = useConnection();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);

  /**
   * Form state that holds data for the liquidity pool setup.
   */
  const [form, setForm] = useState<{
    governedAccount: AssetAccount | undefined;
    baseTokenMint: string;
    quoteTokenMint: string;
    quoteTokenAmount: string;
    baseTokenAmount: string;
    configAddress: string;
    allocations: { address: string; percentage: number }[];
    strategy: StrategyType;
  }>({
    governedAccount: undefined,
    baseTokenMint: '',
    quoteTokenMint: '',
    quoteTokenAmount: '0',
    baseTokenAmount: '0',
    configAddress: '',
    allocations: [],
    strategy: StrategyType.SpotBalanced,
  });

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>(StrategyType.SpotBalanced);

  /**
   * Yup validation schema to validate form inputs.
   */
  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    baseTokenMint: yup.string().required('Base Token Mint Address is required'),
    quoteTokenMint: yup.string().required('Quote Token Mint Address is required'),
    quoteTokenAmount: yup.number().required('Quote token amount is required').min(0, 'Amount must be greater than or equal to 0'),
    baseTokenAmount: yup.number().required('Base token amount is required').min(0, 'Amount must be greater than or equal to 0'),
    configAddress: yup.string().required('Config address is required'),
    allocations: yup.array().of(
      yup.object().shape({
        address: yup.string().required('Address is required'),
        percentage: yup.number().required('Percentage is required'),
      })
    ),
  });

  /**
   * Retrieves the instruction for creating a liquidity pool and validates the form data.
   * 
   * @returns {Promise<UiInstruction>} - The serialized instruction and its validity.
   */
  async function getInstruction(): Promise<UiInstruction> {
    console.log('Validating instruction and fetching data...');
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    console.log(`Validation result: ${isValid}`);
    
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey || !connected) {
      console.log('Validation failed or missing required data.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance ?? undefined };
    }
  
    // Initialize DLMM instance
    const USDC_USDT_POOL = new PublicKey(form.configAddress); // Using configAddress from form
    const dlmmPool = await DLMM.create(connection, USDC_USDT_POOL);
  
    // Get Active Bin (current price info)
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinPricePerToken = dlmmPool.fromPricePerLamport(Number(activeBin.price));
  
    // Set the total token amounts based on active bin price
    const totalXAmount = new BN(Number(form.baseTokenAmount)); // Base token amount from form
    const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken))); // Adjusted based on price per token
  
    // Total range interval for the liquidity position
    const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
    const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;
  
    const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: new PublicKey(form.governedAccount?.governance?.account),
      user: wallet.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: form.strategy,
      },
    });

    /**
     * Sends a transaction to the blockchain and returns the transaction hash.
     * 
     * @param wallet - The wallet used to sign the transaction.
     * @param createPositionTx - The transaction object to send.
     * @returns {Promise<{ txHash: string; isValid: boolean }>} - The transaction hash and validity status.
     */
    interface SendTransactionResult {
      txHash: string;
      isValid: boolean;
    }
    // TODO: We really shouldn't be using any here, but I'm not sure what the type should be
    async function sendTransactionToBlockchain(wallet: any, createPositionTx: any): Promise<SendTransactionResult> {
      try {
      const signedTransaction = await wallet.signTransaction(createPositionTx);
    
      const txHash = await sendAndConfirmTransaction(
        connection,
        signedTransaction,
        [wallet] 
      );
    
      console.log(`Transaction successful with hash: ${txHash}`);
      return { txHash, isValid: true };
      } catch (error) {
      console.error('Transaction failed:', error);
      return { txHash: '', isValid: false };
      }
    }

    const { txHash, isValid: transactionIsValid } = await sendTransactionToBlockchain(wallet, createPositionTx);
    
    return { serializedInstruction: '', isValid: transactionIsValid, governance: form?.governedAccount?.governance ?? undefined };
  }

  useEffect(() => {
    if (form.governedAccount) {
      handleSetInstructions({
        governedAccount: form.governedAccount?.governance,
        getInstruction: () => getInstruction(),
      }, index);
    }
  }, [form.governedAccount, handleSetInstructions, index]);

  /**
   * Defines the inputs for the liquidity pool creation form.
   */
  const inputs: InstructionInput[] = [
    { 
      label: 'Governance', 
      initialValue: form.governedAccount, 
      name: 'governedAccount', 
      type: InstructionInputType.GOVERNED_ACCOUNT, 
      shouldBeGoverned, 
      governance, 
      options: assetAccounts,
      placeholder: 'Select the governance account to associate with this instruction' 
    },
    { 
      label: 'Base Token Mint Address', 
      initialValue: form.baseTokenMint, 
      name: 'baseTokenMint', 
      type: InstructionInputType.INPUT, 
      inputType: 'text', 
      placeholder: 'Enter the mint address of the base token' 
    },
    { 
      label: 'Quote Token Mint Address', 
      initialValue: form.quoteTokenMint, 
      name: 'quoteTokenMint', 
      type: InstructionInputType.INPUT, 
      inputType: 'text', 
      placeholder: 'Enter the mint address of the quote token' 
    },
    { 
      label: 'Quote Token Amount', 
      initialValue: form.quoteTokenAmount, 
      name: 'quoteTokenAmount', 
      type: InstructionInputType.INPUT, 
      inputType: 'number', 
      placeholder: 'Specify the amount of quote token for the transaction' 
    },
    { 
      label: 'Base Token Amount', 
      initialValue: form.baseTokenAmount, 
      name: 'baseTokenAmount', 
      type: InstructionInputType.INPUT, 
      inputType: 'number', 
      placeholder: 'Specify the amount of base token for the transaction' 
    },
    { 
      label: 'Config Address', 
      initialValue: form.configAddress, 
      name: 'configAddress', 
      type: InstructionInputType.INPUT, 
      inputType: 'text', 
      placeholder: 'Enter the configuration address related to the pool or liquidity setup' 
    },
    { 
      label: 'Allocations', 
      initialValue: form.allocations, 
      name: 'allocations', 
      type: InstructionInputType.INPUT, 
      inputType: 'array', 
      placeholder: 'List the allocations for the tokens in this setup' 
    },
    { 
      label: 'Liquidity Strategy', 
      initialValue: selectedStrategy, 
      name: 'strategy', 
      type: InstructionInputType.SELECT, 
      options: strategyOptions, 
      placeholder: 'Choose the liquidity strategy for this operation' 
    },
  ];
  

  return <InstructionForm outerForm={form} setForm={setForm} inputs={inputs} setFormErrors={setFormErrors} formErrors={formErrors} />;
};

export default CreateLiquidityPool;
