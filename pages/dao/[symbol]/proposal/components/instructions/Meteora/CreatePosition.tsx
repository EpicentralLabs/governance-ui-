
 // TODO Replace the hard-coded decimal multiplier (1e6) with on-chain mint decimals
 // TODO verify that PDA/signers are set appropriately for your production environment.

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
// Import the strategy parameters helper (update path as needed)
import { toStrategyParameters } from '@meteora-ag/dlmm/sdk/utils';

// For production, replace this constant with the actual mint decimals (maybe fetch via tryGetMint)
const DEFAULT_DECIMALS = 6;

export enum StrategyTypeEnum {
  SpotBalanced = 0,
  CurveBalanced = 1,
  BidAskBalanced = 2,
  SpotImBalanced = 3,
  CurveImBalanced = 4,
  BidAskImBalanced = 5,
}
const strategyOptions = [
  { label: 'Spot Balanced', value: StrategyTypeEnum.SpotBalanced },
  { label: 'Curve Balanced', value: StrategyTypeEnum.CurveBalanced },
  { label: 'BidAsk Balanced', value: StrategyTypeEnum.BidAskBalanced },
  { label: 'Spot Imbalanced', value: StrategyTypeEnum.SpotImBalanced },
  { label: 'Curve Imbalanced', value: StrategyTypeEnum.CurveImBalanced },
  { label: 'BidAsk Imbalanced', value: StrategyTypeEnum.BidAskImBalanced },
];

interface CreatePositionForm {
  governedAccount: AssetAccount | undefined;
  dlmmPoolAddress: string;
  amountX: string;
  amountY: string;
  strategy: number;
}

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

  const [form, setForm] = useState<CreatePositionForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    amountX: '0',
    amountY: '0',
    strategy: StrategyTypeEnum.SpotBalanced,
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
    amountX: yup.string().required('Amount X is required'),
    amountY: yup.string().required('Amount Y is required'),
    strategy: yup.number().required('Strategy is required'),
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
    let additionalSerializedInstructions: string[] = [];
    try {
      // Instantiate DLMM instance
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      const dlmmPool = await DLMM.create(wallet.connection, dlmmPoolPk);
      await dlmmPool.refetchStates();

      // Get active bin and define bin range (±10 bins)
      const activeBin = await dlmmPool.getActiveBin();
      const minBinId = activeBin.binId - 10;
      const maxBinId = activeBin.binId + 10;

      // Convert input amounts using DEFAULT_DECIMALS (replace with on-chain decimals)
      const totalXAmount = new BN(parseFloat(form.amountX) * Math.pow(10, DEFAULT_DECIMALS));
      const totalYAmount = new BN(parseFloat(form.amountY) * Math.pow(10, DEFAULT_DECIMALS));

      // Convert strategy selection to parameters
      const strategyParams = toStrategyParameters({
        maxBinId,
        minBinId,
        strategyType: form.strategy,
        singleSidedX: false,
      });

      // Generate a new position public key (in production, consider a PDA)
      const newPositionPk = PublicKey.unique();

      const txOrTxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionPk,
        user: wallet.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: strategyParams,
      });

      const txArray = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];
      if (txArray.length === 0) throw new Error('No transactions returned by create position.');
      const primaryInstructions = txArray[0].instructions;
      if (primaryInstructions.length === 0) throw new Error('No instructions in the create position transaction.');

      // Use the first instruction as primary; if additional exist, add them.
      serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
      if (primaryInstructions.length > 1) {
        additionalSerializedInstructions = primaryInstructions.slice(1).map(ix => serializeInstructionToBase64(ix));
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
      label: 'Amount X',
      initialValue: form.amountX,
      name: 'amountX',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Amount Y',
      initialValue: form.amountY,
      name: 'amountY',
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
