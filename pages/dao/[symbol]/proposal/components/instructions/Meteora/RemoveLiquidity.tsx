
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
import { useConnection } from '@solana/wallet-adapter-react';
import { MeteoraRemoveLiquidityForm } from '@utils/uiTypes/proposalCreationTypes';

const DLMMRemoveLiquidity = ({
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

  const [form, setForm] = useState<MeteoraRemoveLiquidityForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    positionPubkey: '',
    removeAll: true,
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
    positionPubkey: yup
      .string()
      .required('Position pubkey is required')
      .test('is-pubkey', 'Invalid position pubkey', (val) => {
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
    try {
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();

      const positionPk = new PublicKey(form.positionPubkey);
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const foundPos = userPositions.find((p) => p.publicKey.equals(positionPk));
      if (!foundPos) {
        throw new Error('Position not found among user positions');
      }

      const binIds = foundPos.positionData.positionBinData.map((b) => b.binId);
      const bpsToRemove = binIds.map(() => new BN(10000)); // Remove 100% (10000 BPS)

      const removeTxOrTxs = await dlmmPool.removeLiquidity({
        position: positionPk,
        user: wallet.publicKey,
        binIds,
        bps: bpsToRemove[0],
        shouldClaimAndClose: form.removeAll,
      });
      const txs = Array.isArray(removeTxOrTxs) ? removeTxOrTxs : [removeTxOrTxs];
      if (txs.length === 0) throw new Error('No transactions returned by removeLiquidity');
      const primaryInstructions = txs[0].instructions;
      if (primaryInstructions.length === 0) throw new Error('No instructions in the remove liquidity transaction.');
      serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
    } catch (err: any) {
      console.error('Error building remove liquidity instruction:', err);
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
      label: 'Position Pubkey',
      initialValue: form.positionPubkey,
      name: 'positionPubkey',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Remove All Liquidity?',
      initialValue: form.removeAll,
      name: 'removeAll',
      type: InstructionInputType.SWITCH,
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

export default DLMMRemoveLiquidity;
