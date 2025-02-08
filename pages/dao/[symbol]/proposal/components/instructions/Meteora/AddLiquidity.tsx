
// TODO Replace the hard-coded multiplier (1e6) with proper on-chain mint decimals.

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
import { toStrategyParameters } from '@meteora-ag/dlmm/sdk/utils';

enum StrategyTypeEnum {
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

interface AddLiquidityForm {
  governedAccount: AssetAccount | undefined;
  dlmmPoolAddress: string;
  positionPubkey: string;
  addAmountX: string;
  addAmountY: string;
  strategy: number;
}

const DLMMAddLiquidity = ({
  index,
  governance,
}: {
  index: number;
  governance: ProgramAccount<Governance> | null;
}) => {
  const { assetAccounts } = useGovernanceAssets();
  const wallet = useWalletOnePointOh();
  const connected = !!wallet?.connected;

  const [form, setForm] = useState<AddLiquidityForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    positionPubkey: '',
    addAmountX: '0',
    addAmountY: '0',
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
    positionPubkey: yup
      .string()
      .required('Existing position pubkey is required')
      .test('is-pubkey', 'Invalid position pubkey', (val) => {
        try {
          new PublicKey(val || '');
          return true;
        } catch {
          return false;
        }
      }),
    addAmountX: yup.string().required('Amount X is required'),
    addAmountY: yup.string().required('Amount Y is required'),
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
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      const dlmmPool = await DLMM.create(wallet.connection, dlmmPoolPk);
      await dlmmPool.refetchStates();

      const activeBin = await dlmmPool.getActiveBin();
      const minBinId = activeBin.binId - 10;
      const maxBinId = activeBin.binId + 10;

      const xAmount = new BN(parseFloat(form.addAmountX) * Math.pow(10, DEFAULT_DECIMALS));
      const yAmount = new BN(parseFloat(form.addAmountY) * Math.pow(10, DEFAULT_DECIMALS));
      const positionPk = new PublicKey(form.positionPubkey);
      const strategyParams = toStrategyParameters({
        maxBinId,
        minBinId,
        strategyType: form.strategy,
        singleSidedX: false,
      });

      const txOrTxs = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionPk,
        user: wallet.publicKey,
        totalXAmount: xAmount,
        totalYAmount: yAmount,
        strategy: strategyParams,
      });

      const txArray = Array.isArray(txOrTxs) ? txOrTxs : [txOrTxs];
      if (txArray.length === 0) throw new Error('No transactions returned by addLiquidity.');
      const primaryInstructions = txArray[0].instructions;
      if (primaryInstructions.length === 0) throw new Error('No instructions in the add liquidity transaction.');
      serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
      if (primaryInstructions.length > 1) {
        additionalSerializedInstructions = primaryInstructions.slice(1).map(ix => serializeInstructionToBase64(ix));
      }
    } catch (err: any) {
      console.error('Error building add liquidity instruction:', err);
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
      label: 'Position Pubkey',
      initialValue: form.positionPubkey,
      name: 'positionPubkey',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Amount X',
      initialValue: form.addAmountX,
      name: 'addAmountX',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Amount Y',
      initialValue: form.addAmountY,
      name: 'addAmountY',
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

export default DLMMAddLiquidity;
