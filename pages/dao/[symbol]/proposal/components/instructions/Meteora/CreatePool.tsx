import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { BN } from 'bn.js';
import { ProgramAccount, serializeInstructionToBase64, Governance } from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { PublicKey } from '@solana/web3.js';
import { NewProposalContext } from '../../../new';
import InstructionForm, { InstructionInput } from '../FormCreator';
import { InstructionInputType } from '../inputInstructionType';
import useWalletOnePointOh from '@hooks/useWalletOnePointOh';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import DLMM from '@meteora-ag/dlmm';
import { toStrategyParameters } from '@meteora-ag/dlmm';
import { useConnection } from '@solana/wallet-adapter-react';
import { MeteoraCreatePositionForm } from '@utils/uiTypes/proposalCreationTypes';
import { getMintDecimals } from './GetMintDecimals';
import { StrategyParameters } from '@meteora-ag/dlmm';

/**
 * @deprecated Use MeteroaCreateLiquidityPool instead!
 * 
 */
const DLMMCreatePosition = ({
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
  const [form, setForm] = useState<MeteoraCreatePositionForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    positionPubkey: '',
    quoteToken: '0',
    baseToken: '0',
    strategy: 0,
  });

  /**
   * Yup schema for validating the DLMM position creation form.
   * Ensures all required fields are filled and that numeric values are in the expected range.
   */
  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    dlmmPoolAddress: yup.string().required('DLMM Pool Address is required'),
    positionPubkey: yup.string().required('Position Pubkey is required'),
    quoteToken: yup.number().required('quoteToken is required').min(0, 'quoteToken must be greater than or equal to 0'),
    baseToken: yup.number().required('baseToken is required').min(0, 'baseToken must be greater than or equal to 0'),
    strategy: yup.number().required('Strategy is required'),
  });

  /**
   * Fetches and validates the instruction for creating a DLMM liquidity position.
   * Uses the provided form data to build a transaction that interacts with the DLMM pool and creates the position.
   * If validation or instruction creation fails, returns a result indicating failure.
   * 
   * @returns {Promise<UiInstruction>} A promise that resolves to an object containing the serialized instruction for the transaction
   */
  async function getInstruction(): Promise<UiInstruction> {
    console.log('Validating instruction and fetching data...');
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    console.log(`Validation result: ${isValid}`);
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

      const activeBin = await dlmmPool.getActiveBin();
      const minBinId = activeBin.binId - 10;
      const maxBinId = activeBin.binId + 10;

      console.log(`Active bin ID: ${activeBin.binId}, minBinId: ${minBinId}, maxBinId: ${maxBinId}`);

      const mintDecimals = await getMintDecimals(dlmmPoolPk.toBase58());
      console.log(`Mint decimals: ${mintDecimals}`);

      const quoteTokenAmount = new BN(parseFloat(form.quoteToken) * Math.pow(10, mintDecimals));
      const baseTokenAmount = new BN(parseFloat(form.baseToken) * Math.pow(10, mintDecimals));
   
      console.log(`Amounts calculated: quoteTokenAmount = ${quoteTokenAmount.toString()}, baseTokenAmount = ${baseTokenAmount.toString()}`);
   
      const positionPk = new PublicKey(form.positionPubkey);

      const strategyParams: StrategyParameters = {
        minBinId,
        maxBinId,
        strategyType: form.strategy,
        singleSidedX: false,
      };

      
      
      const txOrTxs = await dlmmPool.createEmptyPosition({
        positionPubKey: positionPk,
        user: wallet.publicKey,
        ...strategyParams,
      });
      
      const txArray = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];
      if (txArray.length === 0) throw new Error('No transactions returned by create position.');
      const primaryInstructions = txArray[0].instructions;
      if (primaryInstructions.length === 0) throw new Error('No instructions in the create position transaction.');

      serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
      if (primaryInstructions.length > 1) {
        additionalSerializedInstructions = primaryInstructions.slice(1).map((ix: import('@solana/web3.js').TransactionInstruction) => serializeInstructionToBase64(ix));
      }
    } catch (err: any) {
      console.error('Error building create position instruction:', err);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    return {
      serializedInstruction,
      additionalSerializedInstructions,
      isValid: true,
      governance: form?.governedAccount?.governance,
    };
  }

  /**
   * Defines the inputs for the DLMM position creation form.
   * These include the governed account, DLMM pool address, position public key, quote and base token amounts, and strategy.
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
    },
    {
      label: 'DLMM Pool Address',
      initialValue: form.dlmmPoolAddress,
      name: 'dlmmPoolAddress',
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

  useEffect(() => {
    handleSetInstructions({ governedAccount: form.governedAccount?.governance, getInstruction }, index);
  }, [form, handleSetInstructions, index]);

  return (
    <InstructionForm
      outerForm={form}
      setForm={setForm}
      inputs={inputs}
      setFormErrors={setFormErrors}
      formErrors={formErrors}
    />
  );
};

export default DLMMCreatePosition;
