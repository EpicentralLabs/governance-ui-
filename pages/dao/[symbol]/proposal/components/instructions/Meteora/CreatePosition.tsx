import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import BN from 'bn.js';
import { ProgramAccount, serializeInstructionToBase64, Governance } from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
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

   const getInstruction = async (): Promise<UiInstruction> => {
    if (!form?.governedAccount?.governance?.account || !wallet?.publicKey || !connected) {
      console.log('Validation failed or missing required data.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    const positionKeypair = Keypair.generate();
    const positionPubKey = positionKeypair.publicKey;
    const serializedInstruction = '';
    const additionalSerializedInstructions: string[] = [];

    try {
      console.log('Building liquidity instruction...');
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      console.log('DLMM Pool Public Key:', dlmmPoolPk.toBase58());

      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();
      console.log(`DLMM Pool created and states refetched: ${dlmmPoolPk.toBase58()}`);

      const activeBin = await dlmmPool.getActiveBin();
      console.log('Active bin:', activeBin);
      const TOTAL_RANGE_INTERVAL = 10;
      const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
      const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

      const activeBinPricePerTokenBN = new BN(Math.floor(Number(activeBin.price) * 1000000000));
      const totalXAmount = new BN(form.tokenAmount);
      const totalYAmount = totalXAmount.mul(activeBinPricePerTokenBN);
      console.log('Active Bin Price Per Token:', activeBinPricePerTokenBN.toString());
      console.log('Calculated Total X Amount:', totalXAmount.toString());
      console.log('Calculated Total Y Amount:', totalYAmount.toString());

      if (totalXAmount.isZero() || activeBinPricePerTokenBN.isZero()) {
        console.error('Error: Zero amount or price per token.');
        setFormErrors((prev) => ({
          ...prev,
          general: 'Invalid token amount or price per token.',
        }));
        return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
      }

      const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
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

      console.log('Transaction returned by initializePositionAndAddLiquidityByStrategy:', createPositionTx);
      const txArray = Array.isArray(createPositionTx) ? createPositionTx : [createPositionTx];

      if (txArray.length === 0) {
        throw new Error('No transactions returned by create position.');
      }

      console.log('Transaction Array:', txArray);
      txArray.forEach((tx, txIndex) => {
        tx.instructions.forEach((instruction, index) => {
          console.log(`Transaction #${txIndex}, Instruction #${index}:`);
          console.log('Program ID:', instruction.programId.toString());
          console.log('Instruction Data (Hex):', instruction.data.toString('hex'));
        });
      });

      const primaryInstructions = txArray[0].instructions;
      console.log('Primary Instructions:', primaryInstructions);

      primaryInstructions.forEach((instr, index) => {
        console.log(`Instruction #${index}:`);
        console.log('Program ID:', instr.programId.toString());
        console.log('Instruction Data (Hex):', instr.data.toString('hex'));
      });

      if (primaryInstructions.length === 0) {
        throw new Error('No instructions in the create position transaction.');
      }

      console.log('Primary Instructions Length:', primaryInstructions.length);
      const serializedPrimaryInstructions: string[] = primaryInstructions.map((instruction) =>
        serializeInstructionToBase64(instruction),
      );
      console.log('Serialized Primary Instructions:', serializedPrimaryInstructions);

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
