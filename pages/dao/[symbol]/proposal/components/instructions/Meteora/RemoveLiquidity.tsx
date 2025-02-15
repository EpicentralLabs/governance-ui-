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
import { PublicKey, Keypair } from '@solana/web3.js';
import { NewProposalContext } from '../../../new';
import InstructionForm, { InstructionInput } from '../FormCreator';
import { InstructionInputType } from '../inputInstructionType';
import { AssetAccount } from '@utils/uiTypes/assets';
import useWalletOnePointOh from '@hooks/useWalletOnePointOh';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import DLMM from '@meteora-ag/dlmm';
import { useConnection } from '@solana/wallet-adapter-react';
import { MeteoraRemoveLiquidityForm } from '@utils/uiTypes/proposalCreationTypes';

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
    positionPubkey: undefined,
    binIds: [],
    liquiditiesBpsToRemove: [],
    dlmmPoolAddress: '',
    removeAll: true,
  });
  const start = Date.now();
  const [formErrors, setFormErrors] = useState<any>({});
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);

  const getInstruction = async (): Promise<UiInstruction> => {
    console.log('Validating form:', form);
  
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    console.log('Validation result:', isValid);
  
    if (
      !isValid ||
      !form?.governedAccount?.governance?.account ||
      !wallet?.publicKey ||
      !connected
    ) {
      console.log('Validation failed or missing necessary data');
      return {
        serializedInstruction: '',
        isValid: false,
        governance: form?.governedAccount?.governance,
      };
    }
  
    try {
      console.log('Form passed validation, proceeding with liquidity removal');
  
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      console.log('DLMM Pool PublicKey:', dlmmPoolPk.toString());
  
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      console.log('DLMM Pool instance created:', dlmmPool);
  
      const positionKeypair = Keypair.generate();
      console.log('Generated Position Keypair:', positionKeypair.publicKey.toString());
  
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      console.log('User positions retrieved:', userPositions);
      if (userPositions.length === 0) {
        console.error('No positions found for the user.');
      }
  
      const foundPos = userPositions.find((p) => form.positionPubkey && p.publicKey.equals(new PublicKey(form.positionPubkey)));
      if (!foundPos) {
        console.error('Position not found among user positions');
        throw new Error('Position not found among user positions');
      }
  
      console.log('Found position:', foundPos);
      const binIds = foundPos.positionData.positionBinData.map((b) => b.binId);
      const bpsToRemove = binIds.map(() => new BN(10000)); // Remove 100% (10000 BPS)
      console.log('Bin IDs:', binIds);
      console.log('BPS to remove:', bpsToRemove);
  
      const removeTxOrTxs = await dlmmPool.removeLiquidity({
        user: wallet.publicKey,
        position: positionKeypair.publicKey,
        binIds,
        bps: bpsToRemove[0],
        shouldClaimAndClose: form.removeAll,
      });
      console.log('Liquidity removal transaction:', removeTxOrTxs);
  
      const txs = Array.isArray(removeTxOrTxs) ? removeTxOrTxs : [removeTxOrTxs];
      if (txs.length === 0) throw new Error('No transactions returned by removeLiquidity');
      const primaryInstructions = txs[0].instructions;
      if (primaryInstructions.length === 0) throw new Error('No instructions in the remove liquidity transaction.');
  
      // Log all instructions for debugging
      primaryInstructions.forEach((instruction, index) => {
        console.log(`Instruction ${index + 1}:`, instruction);
        console.log('Instruction Data:', instruction.data);
        console.log('Instruction Accounts:', instruction.keys.map((key) => key.pubkey.toString()));
      });
      const serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
      console.log('Serialized instruction:', serializedInstruction);
      const duration = Date.now() - start;
      console.log('Duration:', duration);
      return {
        serializedInstruction: '',
        isValid: true,
        governance: form?.governedAccount?.governance,
      };
    } catch (err: any) {
      console.error('Error building remove liquidity instruction:', err);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
  };
  
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
    console.log('Setting instructions for proposal index:', index);
    console.log('Form:', form);
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
