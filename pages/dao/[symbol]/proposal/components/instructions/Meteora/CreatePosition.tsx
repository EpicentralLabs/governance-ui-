import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import BN from 'bn.js';
import { ProgramAccount, serializeInstructionToBase64, Governance } from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { PublicKey, Keypair } from '@solana/web3.js';
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

const strategyOptions = [
  { name: 'Spot Balanced', value: 0 },
  { name: 'Curve Balanced', value: 1 },
  { name: 'BidAsk Balanced', value: 2 },
  { name: 'Spot Imbalanced', value: 3 },
  { name: 'Curve Imbalanced', value: 4 },
  { name: 'BidAsk Imbalanced', value: 5 },
];

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
    tokenAmount: 0,
    quoteToken: '',
    baseToken: '',
    strategy: 0,
    response: ''
  });


async function getInstruction(): Promise<UiInstruction> {

  if (!form?.governedAccount?.governance?.account || !wallet?.publicKey || !connected) {
    console.log('Validation failed or missing required data.');
    return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
  }

  const positionKeypair = Keypair.generate();
  const positionPubKey = positionKeypair.publicKey;
  let serializedInstruction = '';
  let additionalSerializedInstructions: string[] = [];

  try {
    console.log('Building liquidity instruction...');
    const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
    const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
    await dlmmPool.refetchStates();
    console.log(`DLMM Pool created and states refetched: ${dlmmPoolPk.toBase58()}`);


    const activeBin = await dlmmPool.getActiveBin();
    const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
    const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

    console.log(`Active bin ID: ${activeBin.binId}, minBinId: ${minBinId}, maxBinId: ${maxBinId}`);

    // Calculate totalXAmount and totalYAmount
    const activeBinPricePerToken = dlmmPool.fromPricePerLamport(Number(activeBin.price));
    const totalXAmount = new BN(form.tokenAmount);  // Use the token amount entered by the user
    const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

    const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionPubKey,
      user: form.governedAccount?.governance.pubkey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: form.strategy,
      },
    });

    const txArray = Array.isArray(createPositionTx) ? createPositionTx : [createPositionTx];
    if (txArray.length === 0) throw new Error('No transactions returned by create position.');
    const primaryInstructions = txArray[0].instructions;
    if (primaryInstructions.length === 0) throw new Error('No instructions in the create position transaction.');

    serializedInstruction = serializeInstructionToBase64(primaryInstructions[0]);
    if (primaryInstructions.length > 1) {
      additionalSerializedInstructions = primaryInstructions.slice(1).map((ix: import('@solana/web3.js').TransactionInstruction) => serializeInstructionToBase64(ix));
    }

  } catch (err: any) {
    console.error('Error building create position instruction:', err);
    setFormErrors((prev) => ({
      ...prev,
      general: 'Error building create position instruction',
    }));
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
      label: 'Base Token',
      initialValue: form.baseToken,
      name: 'baseToken',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Base Token Amount',
      initialValue: form.tokenAmount,
      name: 'tokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Quote Token',
      initialValue: form.quoteToken,
      name: 'quoteToken',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    {
      label: 'Strategy',
      initialValue: form.strategy,
      name: 'strategy',
      type: InstructionInputType.SELECT,
      inputType: 'select',
      options: strategyOptions,
    },
    {
      label: 'Response',
      initialValue: form.response,
      name: 'response',
      type: InstructionInputType.TEXTAREA,
      inputType: 'text',
    },
  ];

  useEffect(() => {
    handleSetInstructions({ governedAccount: form.governedAccount?.governance, getInstruction }, index);
  }, [form, handleSetInstructions, index]);
  useEffect(() => {
    const fetchTokenPair = async () => {
      if (!form.dlmmPoolAddress) return;
  
      try {
        const uri = `https://dlmm-api.meteora.ag/pair/${form.dlmmPoolAddress}`;
        const response = await fetch(uri);
        if (!response.ok) throw new Error('Failed to fetch token pair data');
  
        const data = await response.json();
        const parsePairs = (pairs: string) => {
          const [quoteToken, baseToken] = pairs.split('-').map((pair: string) => pair.trim());
          return { quoteToken, baseToken };
        };
        const { quoteToken, baseToken } = parsePairs(data.name);
  
        setForm((prevForm) => ({
          ...prevForm,
          baseToken: baseToken,
          quoteToken: quoteToken,
          response: JSON.stringify(data, null, 4),
        }));
  
        console.log(`Updated baseToken: ${baseToken}, quoteToken: ${quoteToken}`);
      } catch (error) {
        console.error('Error fetching token pair:', error);
      }
    };
  
    fetchTokenPair();
  }, [form.dlmmPoolAddress]);
  
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
