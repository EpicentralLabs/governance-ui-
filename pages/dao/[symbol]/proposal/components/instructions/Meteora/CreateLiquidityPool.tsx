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

  const [form, setForm] = useState<{
    governedAccount: AssetAccount | undefined;
    baseTokenMint: string;
    quoteTokenMint: string;
    quoteTokenAmount: string;
    baseTokenAmount: string;
    configAddress: string;
    allocations: { address: string; percentage: number }[];
  }>({
    governedAccount: undefined,
    baseTokenMint: '',
    quoteTokenMint: '',
    quoteTokenAmount: '0',
    baseTokenAmount: '0',
    configAddress: '',
    allocations: [],
  });

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

  useEffect(() => {
    if (form.governedAccount) {
      console.log(`Setting instructions for governed account: ${JSON.stringify(form.governedAccount?.governance)}`);
      handleSetInstructions({
        governedAccount: form.governedAccount?.governance,
        getInstruction: () => getInstruction(),
      }, index);
    }
  }, [form.governedAccount, handleSetInstructions, index]);

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
      label: 'Base Token Mint Address',
      initialValue: form.baseTokenMint,
      name: 'baseTokenMint',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Quote Token Mint Address',
      initialValue: form.quoteTokenMint,
      name: 'quoteTokenMint',
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

export default CreateLiquidityPool;
