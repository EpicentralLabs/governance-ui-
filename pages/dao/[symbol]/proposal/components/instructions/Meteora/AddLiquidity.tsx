import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { BN } from 'bn.js';
import {
  Governance,
  ProgramAccount,
  serializeInstructionToBase64,
} from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { PublicKey } from '@solana/web3.js';
import { NewProposalContext } from '../../../new';
import InstructionForm, { InstructionInput } from '../FormCreator';
import { InstructionInputType } from '../inputInstructionType';
import { AssetAccount } from '@utils/uiTypes/assets';
import useWalletOnePointOh from '@hooks/useWalletOnePointOh';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import DLMM from '@meteora-ag/dlmm';
import { StrategyParameters, StrategyType } from '@meteora-ag/dlmm';
import { useConnection } from '@solana/wallet-adapter-react';
import { MeteoraAddLiquidityForm } from '@utils/uiTypes/proposalCreationTypes';
import { getMintDecimals } from './GetMintDecimals';

/**
 * Available liquidity strategy options for DLMM pools.
 */
const strategyOptions = [
  { name: 'Spot Balanced', value: 6 },
  { name: 'Curve Balanced', value: 7 },
  { name: 'BidAsk Balanced', value: 8 },
  { name: 'Spot Imbalanced', value: 3 },
  { name: 'Curve Imbalanced', value: 4 },
  { name: 'BidAsk Imbalanced', value: 5 },
  { name: 'Spot OneSide', value: 0 },
  { name: 'Curve OneSide', value: 1 },
  { name: 'BidAsk OneSide', value: 2 },
];

/**
 * A component that handles the liquidity addition to a DLMM pool in a governance context.
 * It validates form data and constructs instructions for adding liquidity by strategy to the pool.
 *
 * @param index The index of the liquidity pool in the current proposal.
 * @param governance The governance account associated with the current proposal.
 * @returns JSX element to render the instruction form.
 */
const DLMMAddLiquidity = ({
  index,
  governance,
}: {
  index: number;
  governance: ProgramAccount<Governance> | null;
}) => {
  // Fetch governance assets and wallet details
  const { assetAccounts } = useGovernanceAssets();
  const wallet = useWalletOnePointOh();
  const connected = !!wallet?.connected;
  const { connection } = useConnection();

  // State for form errors and the form values themselves
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);

  // Form state initialization
  const [form, setForm] = useState<MeteoraAddLiquidityForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    positionPubkey: '',
    quoteToken: '0',
    baseToken: '0',
    strategy: 0,
  });

  // Yup validation schema
  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    dlmmPoolAddress: yup.string().required('DLMM Pool Address is required'),
    positionPubkey: yup.string().required('Position Pubkey is required'),
    quoteToken: yup.number().required('quoteToken is required').min(0, 'quoteToken must be greater than or equal to 0'),
    baseToken: yup.number().required('baseToken is required').min(0, 'baseToken must be greater than or equal to 0'),
    strategy: yup.number().required('Strategy is required'),
  });

  /**
   * Constructs and validates the instruction to add liquidity to the DLMM pool.
   *
   * @returns A promise containing the serialized instruction and other transaction data.
   */
  async function getInstruction(): Promise<UiInstruction> {
    console.log('Validating instruction and fetching data...');
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    console.log(`Validation result: ${isValid}`);

    // Early exit if validation fails or if required data is missing
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey || !connected) {
      console.log('Validation failed or missing required data.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    let serializedInstruction = '';
    let additionalSerializedInstructions: string[] = [];

    try {
      console.log('Building liquidity instruction...');
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();
      console.log(`DLMM Pool created and states refetched: ${dlmmPoolPk.toBase58()}`);

      // Fetch active bin data for price and liquidity range
      const activeBin = await dlmmPool.getActiveBin();
      const minBinId = activeBin.binId - 10;
      const maxBinId = activeBin.binId + 10;

      console.log(`Active bin ID: ${activeBin.binId}, minBinId: ${minBinId}, maxBinId: ${maxBinId}`);

      // Get mint decimals to scale token amounts correctly
      const mintDecimals = await getMintDecimals(dlmmPoolPk.toBase58());
      console.log(`Mint decimals: ${mintDecimals}`);

      const quoteTokenAmount = new BN(parseFloat(form.quoteToken) * Math.pow(10, mintDecimals));
      const baseTokenAmount = new BN(parseFloat(form.baseToken) * Math.pow(10, mintDecimals));

      console.log(`Amounts calculated: quoteTokenAmount = ${quoteTokenAmount.toString()}, baseTokenAmount = ${baseTokenAmount.toString()}`);

      // Ensure positionPubkey is defined and valid
      if (!form.positionPubkey || typeof form.positionPubkey !== 'string') {
        throw new Error('Position Pubkey is required and must be a valid string');
      }

      const positionPk = new PublicKey(form.positionPubkey);

      // Define strategy parameters based on the selected strategy
      const strategyParams: StrategyParameters = {
        maxBinId,
        minBinId,
        strategyType: form.strategy as unknown as StrategyType,
        singleSidedX: false,
      };

      console.log('Calling DLMM addLiquidityByStrategy...');
      const txOrTxs = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionPk,
        user: wallet.publicKey,
        totalXAmount: quoteTokenAmount,
        totalYAmount: baseTokenAmount,
        strategy: strategyParams,
      });

      const txArray = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];
      if (txArray.length === 0) {
        console.error('No transactions returned by addLiquidity.');
        throw new Error('No transactions returned by addLiquidity.');
      }

      console.log(`Transactions returned: ${txArray.length}`);
      const primaryInstructions = txArray[0].instructions;
      if (primaryInstructions.length === 0) {
        console.error('No instructions in the add liquidity transaction.');
        throw new Error('No instructions in the add liquidity transaction.');
      }

      console.log('Instructions found, serializing...');
      serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);

      if (primaryInstructions.length > 1) {
            // TODO: We really shouldn't be using any here, but I'm not sure what the type should be

        additionalSerializedInstructions = primaryInstructions.slice(1).map((ix: any) => serializeInstructionToBase64(ix));
        console.log('Additional instructions found and serialized.');
      }
    } catch (err: any) {
      console.error('Error building add liquidity instruction:', err);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    console.log('Instruction build complete.');
    return {
      serializedInstruction,
      additionalSerializedInstructions,
      isValid: true,
      governance: form?.governedAccount?.governance,
    };
  }

  // Handle setting the instructions when form state changes
  useEffect(() => {
    if (form.governedAccount) {
      console.log(`Setting instructions for governed account: ${JSON.stringify(form.governedAccount?.governance)}`);
      handleSetInstructions({
        governedAccount: form.governedAccount?.governance,
        getInstruction: () => getInstruction(),
      }, index);
    }
  }, [form.governedAccount, handleSetInstructions, index]);

  // Define input fields for the form
  const inputs: InstructionInput[] = [
    {
      label: 'Governance',
      initialValue: form.governedAccount,
      name: 'governedAccount',
      type: InstructionInputType.GOVERNED_ACCOUNT,
      shouldBeGoverned,
      governance,
      options: assetAccounts,
    },
    {
      label: 'DLMM Pool Address',
      initialValue: form.dlmmPoolAddress,
      name: 'dlmmPoolAddress',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Position Pubkey',
      initialValue: form.positionPubkey,
      name: 'positionPubkey',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Quote Token',
      initialValue: form.quoteToken,
      name: 'quoteToken',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Base Token',
      initialValue: form.baseToken,
      name: 'baseToken',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Strategy',
      initialValue: form.strategy,
      name: 'strategy',
      type: InstructionInputType.SELECT,
      inputType: 'select',
      options: strategyOptions,
    },
  ];

  return <InstructionForm 
    outerForm={form} 
    setForm={setForm} 
    inputs={inputs} 
    setFormErrors={setFormErrors} 
    formErrors={formErrors} 
  />;
};

export default DLMMAddLiquidity;
