import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { Governance, ProgramAccount } from '@solana/spl-governance';
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
import BN from 'bn.js';
import { MeteoraClaimRewardsForm } from '@utils/uiTypes/proposalCreationTypes';
import { fetchPoolData } from '@utils/Meteora/fetchPoolData';

/**
 * Component to manage the claiming of rewards from a DLMM pool in a governance proposal.
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
    positions: '',
    positions2: '',
  });
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);

  const [positionString, setPositions] = useState<string>("");
  const [positionString2] = useState<string>("");
  const [totalRewards, setTotalRewards] = useState<BN>(new BN(0));
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

  // Fetch user positions when the DLMM pool address or wallet changes
  useEffect(() => {
    const fetchUserPositions = async () => {
      if (!form.dlmmPoolAddress || !form.governedAccount?.governance?.pubkey || !wallet?.publicKey) return;
  
      console.log('Fetching user positions for pool address:', form.dlmmPoolAddress);
      const startTime = Date.now();
      console.log('Start time:', startTime);
  
      try {
        const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
        const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
  
        // Fetch positions for the user's wallet
        const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
        console.log("Full userPositions response:", JSON.stringify(userPositions, null, 2));
  
        if (!userPositions || userPositions.length === 0) {
          console.log('No valid positions found.');
          setForm((prevForm) => ({
            ...prevForm,
            positions: "", 
          }));
          setFormErrors((prevErrors) => ({
            ...prevErrors,
            positions: 'No valid positions found, please check your pool address.',
          }));
          return;
        }
  
        // Use the first position if available
        const position = userPositions[0];
        const rewardOne = new BN(position.positionData.rewardOne || 0);
        const rewardTwo = new BN(position.positionData.rewardTwo || 0);
        const totalRewards = rewardOne.add(rewardTwo);
    
        console.log('Total Rewards:', totalRewards.toString());
  
        // Fetch pool data to append to the reward string
        const poolData = await fetchPoolData(form.dlmmPoolAddress); 
        const rewardString = `${poolData.baseToken} - ${totalRewards.toString()} | ${poolData.quoteToken} - ${totalRewards.toString()}`;
        const positionString = `${position.publicKey.toString().slice(0, 4)}...${position.publicKey.toString().slice(-4)}`;
        
        // Update the form state with rewards and position string
        setForm((prevForm) => ({ ...prevForm, rewards: rewardString }));
        setForm((prevForm) => ({ ...prevForm, positions: positionString || "" }));
        setForm((prevForm) => ({ ...prevForm, positions2: positionString || "" }));

        // Set the position public key in the positions state
        setPositions(position.publicKey.toString());
  
        const duration = Date.now() - startTime + 'ms';
        console.log('Time to fetch user positions:', duration);
  
      } catch (err: any) {
        console.error('Error fetching user positions:', err.message);
        setPositions(""); // Set to empty string on error
      }
    };
  
    fetchUserPositions();
  }, [form.dlmmPoolAddress, form.governedAccount, wallet, connection]);
  
  

// Fetch position data for each position
const fetchPositionData = async (dlmmPool: any, position: string) => {
  console.log('Fetching position data for:', position);

  // Assuming position is a publicKey string, find the corresponding rewardInfo
  const positionData = dlmmPool.lbPair.rewardInfos.find((rewardInfo: any) => {
    return rewardInfo.mint.toBase58() === position; // Match the publicKey with mint
  });

  if (!positionData) {
    console.error('Position data not found for:', position);
    throw new Error('Position data not found');
  }

  console.log('Position Data:', positionData);

  // Convert the reward values from BN (big number) to integers
  const rewardOne = new BN(positionData.rewardOne || 0);
  const rewardTwo = new BN(positionData.rewardTwo || 0);
  console.log('Reward One:', rewardOne.toString());
  console.log('Reward Two:', rewardTwo.toString());

  const totalRewards = rewardOne.add(rewardTwo);
  console.log('Total Rewards:', totalRewards.toString());

  // Return the position data along with calculated rewards
  return {
    totalXAmount: positionData.totalXAmount || '0',
    totalYAmount: positionData.totalYAmount || '0',
    positionBinData: positionData.positionBinData || [],
    lastUpdatedAt: new BN(Date.now()), // Timestamp for when the data was fetched
    upperBinId: positionData.upperBinId || 0,
    lowerBinId: positionData.lowerBinId || 0,
    feeX: new BN(positionData.feeX || 0),
    feeY: new BN(positionData.feeY || 0),
    binX: positionData.binX || '0',
    binY: positionData.binY || '0',
    binId: positionData.binId || '0',
    rewardOne, // Include reward values as BN
    rewardTwo,
    feeOwner: wallet?.publicKey || new PublicKey(''), // Fee owner (wallet public key)
    totalClaimedFeeXAmount: new BN(positionData.totalClaimedFeeXAmount || 0),
    totalClaimedFeeYAmount: new BN(positionData.totalClaimedFeeYAmount || 0),
    totalRewards: totalRewards.toString(), // Total rewards calculated from rewardOne and rewardTwo
  };
};


  // Handle the instruction for claiming rewards
  const getInstruction = async (): Promise<UiInstruction> => {
    console.log('Validating instruction with form:', form);

    const isValid = await validateInstruction({ schema, form, setFormErrors });
    if (!isValid || !form?.governedAccount?.governance?.account || !wallet?.publicKey) {
      console.log('Invalid instruction or missing required data.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    if (!connected) {
      console.log('Wallet is not connected.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    const { positions } = form;
    if (!positions || positions.length === 0) {
      console.error('No position selected.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance };
    }

    try {
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
      await dlmmPool.refetchStates();

      console.log('DLMM Pool for claiming rewards:', dlmmPool);

      // Fetch position data for each position selected
      const positionDataPromises = positions.map(async (position) => fetchPositionData(dlmmPool, position));
      const positionData = await Promise.all(positionDataPromises);
      console.log('Fetched position data:', positionData);

      // Calculate total rewards (rewardOne + rewardTwo)
      const totalRewards = positionData.reduce(
        (total, data) => total.add(new BN(data.rewardOne)).add(new BN(data.rewardTwo)),
        new BN(0)
      );
      console.log('Total rewards:', totalRewards.toString());

      // Update rewards field in the form
      setForm((prevForm) => ({ ...prevForm, rewards: totalRewards.toString() }));

      // Claim rewards for all positions
      const claimTxs = await dlmmPool.claimAllRewards({
        owner: wallet.publicKey,
        positions: positionData.map((data, idx) => ({
          publicKey: new PublicKey(positions[idx]),
          positionData: data,
          version: 1,
        })),
      });

      console.log('Claim transactions:', claimTxs);

      if (claimTxs.length === 0) {
        throw new Error('No transactions returned by claimAllRewards');
      }

      const instructions = claimTxs[0].instructions;
      if (instructions.length === 0) {
        throw new Error('No instructions in the claimAllRewards transaction.');
      }

      console.log('Claim instruction:', instructions[0]);

      return {
        serializedInstruction: '',
        isValid: true,
        governance: form?.governedAccount?.governance,
      };
    } catch (err: any) {
      console.error('Error building claimAllRewards instruction:', err.message);
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
      label: 'Rewards',
      initialValue: form.rewards,
      name: 'rewards',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
    // {
    //   label: 'Positions',
    //   initialValue: form.positions,
    //   name: 'positions',
    //   type: InstructionInputType.TEXTAREA,
    //   inputType: 'text',
    // },
    {
      label: 'Positions',
      initialValue: form.positions2,
      name: 'positions2',
      type: InstructionInputType.INPUT,
    }
    
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
