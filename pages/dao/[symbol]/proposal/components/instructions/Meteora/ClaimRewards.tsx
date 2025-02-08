
import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
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
import { useConnection } from '@solana/wallet-adapter-react';
import { MeteoraClaimRewardsForm } from '@utils/uiTypes/proposalCreationTypes';


const DLMMClaimAllRewards = ({
  index,
  governance,
}: {
  index: number;
  governance: ProgramAccount<Governance> | null;
}) => {
  const { assetAccounts } = useGovernanceAssets();
  const wallet = useWalletOnePointOh();
  const { connection } = useConnection();
  const connected = !!wallet?.connected;

  const [form, setForm] = useState<MeteoraClaimRewardsForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    rewards: '',
  });
  const [formErrors, setFormErrors] = useState<any>({});
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);

  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    dlmmPoolAddress: yup
      .string()
      .required('DLMM pool address is required')
      .test('is-pubkey', 'Invalid pool address', (val) => {
        try {
          new PublicKey(val || '');
          return true;
        } catch {
          return false;
        }
      }),
  });

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey) {
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
    if (!connected) {
      return { serializedInstruction: '', isValid: false, governance: form.governedAccount?.governance };
    }

    let serializedInstruction = '';
    const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
    try {
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();

      const claimTxs = await dlmmPool.claimAllRewards({ owner: wallet.publicKey, positions: [] });
      if (claimTxs.length === 0) {
        throw new Error('No transactions returned by claimAllRewards');
      }
      const instructions = claimTxs[0].instructions;
      if (instructions.length === 0) {
        throw new Error('No instructions in the claimAllRewards transaction.');
      }
      serializedInstruction = serializeInstructionToBase64(instructions[0]);
    } catch (err: any) {
      console.error('Error building claimAllRewards instruction:', err);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    return {
      serializedInstruction,
      isValid: true,
      governance: form?.governedAccount?.governance,
    };
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
      label: 'DLMM Pool Address',
      initialValue: form.dlmmPoolAddress,
      name: 'dlmmPoolAddress',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Rewards',
      initialValue: form.rewards,
      name: 'rewards',
      type: InstructionInputType.INPUT,
      inputType: 'text',
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

export default DLMMClaimAllRewards;
