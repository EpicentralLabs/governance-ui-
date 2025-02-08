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
import { useConnection } from '@solana/wallet-adapter-react';
import { getMintDecimals } from './GetMintDecimals';

const CreateMeteoraPool = ({
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
  interface GovernedAccount {
    governance: ProgramAccount<Governance> | null;
  }

  const [form, setForm] = useState<{
    governedAccount: GovernedAccount | undefined;
    tokenAMint: string;
    tokenBMint: string;
    quoteTokenAmount: string;
    baseTokenAmount: string;
    configAddress: string;
    allocations: { address: string; percentage: number }[];
  }>({
    governedAccount: undefined,
    tokenAMint: '',
    tokenBMint: '',
    quoteTokenAmount: '0',
    baseTokenAmount: '0',
    configAddress: '',
    allocations: [],
  });

  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    tokenAMint: yup.string().required('Token A Mint Address is required'),
    tokenBMint: yup.string().required('Token B Mint Address is required'),
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

  async function getInstruction(): Promise<UiInstruction> {
    console.log('Validating instruction and fetching data...');
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    console.log(`Validation result: ${isValid}`);
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey || !connected) {
      console.log('Validation failed or missing required data.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance ?? undefined };
    }
    return { serializedInstruction: '', isValid: true, governance: form?.governedAccount?.governance };
  }

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
      label: 'Token A Mint Address',
      initialValue: form.tokenAMint,
      name: 'tokenAMint',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Token B Mint Address',
      initialValue: form.tokenBMint,
      name: 'tokenBMint',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Quote Token Amount',
      initialValue: form.quoteTokenAmount,
      name: 'quoteTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Base Token Amount',
      initialValue: form.baseTokenAmount,
      name: 'baseTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Config Address',
      initialValue: form.configAddress,
      name: 'configAddress',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Allocations',
      initialValue: form.allocations,
      name: 'allocations',
      type: InstructionInputType.INPUT,
      inputType: 'array',
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

export default CreateMeteoraPool;
