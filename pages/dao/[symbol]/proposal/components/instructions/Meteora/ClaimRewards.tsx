import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { Governance, ProgramAccount, serializeInstructionToBase64 } from '@solana/spl-governance';
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

/**
 * Component to manage the claiming of rewards from a DLMM pool in a governance proposal.
 * It allows the user to submit instructions for claiming rewards, and validates the form data before submission.
 * 
 * @param {object} props - The component properties.
 * @param {number} props.index - The index of the component in the parent container.
 * @param {ProgramAccount<Governance> | null} props.governance - The governance object that is associated with the proposal.
 * 
 * @returns {JSX.Element} The rendered component containing the instruction form for claiming rewards.
 */
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
    positions: [],
  });
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
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
    selectedPosition: yup.string().required('You must select a position'),
  });
  const [positions, setPositions] = useState<string[]>([]);

  // Fetch user positions when DLMM Pool Address is entered
  useEffect(() => {
    const fetchUserPositions = async () => {
      if (!form.dlmmPoolAddress || !form.governedAccount?.governance?.pubkey) return;

      try {
        const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
        const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
        
        const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
          new PublicKey(form.governedAccount.governance.pubkey)
        );

        if (!userPositions || userPositions.length === 0) {
          throw new Error('No positions found for this owner.');
        }

        const binData = userPositions[0]?.positionData?.positionBinData || [];
        const positionsList = binData.map((bin: any) => bin.position);

        setPositions(positionsList);
      } catch (err: any) {
        console.error('Error fetching user positions:', err.message);
        setPositions([]); // Reset positions on error
      }
    };

    fetchUserPositions();
  }, [form.dlmmPoolAddress, form.governedAccount, connection]);

  const getInstruction = async (): Promise<UiInstruction> => {
    const isValid = await validateInstruction({ schema, form, setFormErrors });
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey) {
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
    if (!connected) {
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
  
    if (!form.dlmmPoolAddress) {
      console.error('DLMM Pool Address is missing');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
  
    const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
  
    try {
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();
  
      // Fetch positions
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
        form?.governedAccount?.governance?.pubkey
      );
  
      if (!userPositions || userPositions.length === 0) {
        throw new Error('No positions found for this owner.');
      }
  
      // Extract position public keys
      const positions = userPositions.map((position) => position);
  
      console.log('Positions:', positions);
  
      // Claim rewards
      const claimTxs = await dlmmPool.claimAllRewards({ owner: wallet.publicKey, positions: positions });
  
      if (claimTxs.length === 0) {
        throw new Error('No transactions returned by claimAllRewards');
      }
  
      const instructions = claimTxs[0].instructions;
      if (instructions.length === 0) {
        throw new Error('No instructions in the claimAllRewards transaction.');
      }
  
      const serializedInstruction = serializeInstructionToBase64(instructions[0]);
  
      return {
        serializedInstruction,
        isValid: true,
        governance: form?.governedAccount?.governance,
      };
    } catch (err: any) {
      console.error('Error building claimAllRewards instruction:', err.message);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }
  };
  

  /**
   * Form inputs that allow the user to configure the rewards claiming operation.
   * Includes input fields for the governed account, DLMM pool address, and rewards amount.
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
      label: 'Rewards',
      initialValue: form.rewards,
      name: 'rewards',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
     {
          label: 'Positions',
          initialValue: form.positions,
          name: 'positions',
          type: InstructionInputType.SELECT,
          inputType: 'select',
          options: positions.map((position) => ({ value: position, label: position })),
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
