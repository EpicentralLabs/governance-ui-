import React, { useContext, useEffect, useState } from 'react';
import * as yup from 'yup';
import { Governance, ProgramAccount, serializeInstructionToBase64 } from '@solana/spl-governance';
import { validateInstruction } from '@utils/instructionTools';
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes';
import { NewProposalContext } from '../../../new';
import InstructionForm, { InstructionInput } from '../FormCreator';
import { InstructionInputType } from '../inputInstructionType';
import { AssetAccount } from '@utils/uiTypes/assets';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import bs58 from 'bs58';

/**
 * Validates if a string is a valid base58 encoded value
 * @param value - String to validate
 * @returns boolean indicating if string is valid base58
 */
function isBase58(value: string): boolean {
  try {
    bs58.decode(value);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Component for creating a liquidity pool on Solana using DLMM and governance features.
 * Allows users to create a new DLMM pool by specifying base and quote token mints,
 * with governance controls and validation.
 *
 * @param {Object} props - The component props.
 * @param {number} props.index - The index for this liquidity pool form in the parent component.
 * @param {ProgramAccount<Governance> | null} props.governance - The governance account associated with this pool.
 *
 * @returns {JSX.Element} - The rendered CreateLiquidityPool form.
 */
const CreateDLMM = ({ index, governance }: { index: number; governance: ProgramAccount<Governance> | null; }) => {
  // Hook to access governance asset accounts
  const { assetAccounts } = useGovernanceAssets();
  // Hook to access Solana connection
  const { connection } = useConnection();
  // State for form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // Context for managing proposal instructions
  const { handleSetInstructions } = useContext(NewProposalContext);
  // Flag to determine if account should be governed
  const shouldBeGoverned = !!(index !== 0 && governance);
  
  // Form state containing pool creation parameters
  const [form, setForm] = useState<{
    governedAccount: AssetAccount | undefined;
    baseTokenMint: string;
    quoteTokenMint: string;
    baseFee: number;
    binSize: number;
  }>({
    governedAccount: undefined,
    baseTokenMint: '',
    quoteTokenMint: '',
    baseFee: 0,
    binSize: 0,
  });

  // Validation schema for the form
  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required('Governed account is required'),
    baseTokenMint: yup.string().required('Base Token Mint is required'),
    quoteTokenMint: yup.string().required('Quote Token Mint is required'),
    baseFee: yup.number().required('Base Fee is required').min(0, 'Base Fee must be non-negative'),
    binSize: yup.number().required('Bin Size is required').min(0, 'Bin Size must be non-negative'),
  });

  
  /**
   * Validates ownership of a token account to ensure it exists and is owned by the token program
   * @param tokenMint - The mint address to validate
   * @returns Promise resolving to boolean indicating if ownership is valid
   */
  async function validateTokenAccountOwnership(tokenMint: string): Promise<boolean> {
    try {
      const tokenPublicKey = new PublicKey(tokenMint);
      const tokenAccountInfo = await connection.getAccountInfo(tokenPublicKey);
      
      if (!tokenAccountInfo) {
        console.error(`Token account for mint ${tokenMint} not found.`);
        return false;
      }

      // Check if the token account is owned by the token program
      const tokenProgramId = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
      if (!tokenAccountInfo.owner.equals(tokenProgramId)) {
        console.error(`Token account for mint ${tokenMint} is not owned by the Token Program.`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating token account ownership:', error);
      return false;
    }
  }

  /**
   * Performs validation checks on form data before pool creation
   * Validates governance account, token mints, and token account ownership
   * @returns Promise resolving to boolean indicating if all checks passed
   */
  const preCheckValidation = async () => {
    const errors: Record<string, string> = {};

    if (!form.governedAccount?.governance?.account) {
      errors.governedAccount = 'Governed account is required';
    }

    if (!form.baseTokenMint || !form.quoteTokenMint) {
      errors.tokenMints = 'Both token mint addresses must be provided';
    } else {
      // Validate base and quote token mints are base58
      if (!isBase58(form.baseTokenMint)) {
        errors.baseTokenMint = 'Base Token Mint is not a valid base58 string';
      }
      if (!isBase58(form.quoteTokenMint)) {
        errors.quoteTokenMint = 'Quote Token Mint is not a valid base58 string';
      }

      const baseTokenOwnership = await validateTokenAccountOwnership(form.baseTokenMint);
      if (!baseTokenOwnership) {
        errors.baseTokenMint = 'Base Token Account ownership validation failed.';
      }

      const quoteTokenOwnership = await validateTokenAccountOwnership(form.quoteTokenMint);
      if (!quoteTokenOwnership) {
        errors.quoteTokenMint = 'Quote Token Account ownership validation failed.';
      }
    }

    setFormErrors(errors);

    return Object.keys(errors).length === 0;
  };
  
  /**
   * Creates a new DLMM pool instruction using provided token mints
   * @returns Promise resolving to TransactionInstruction or null if creation fails
   */
  async function createNewPoolInstruction(): Promise<TransactionInstruction | null> {
    try {
      const baseTokenPublicKey = new PublicKey(form.baseTokenMint); 
      const quoteTokenPublicKey = new PublicKey(form.quoteTokenMint);

      // Create new DLMM pool with additional parameters
      await DLMM.create(connection, baseTokenPublicKey, {
        programId: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        // Correct or remove invalid properties
        // baseFee: form.baseFee,
        // binSize: form.binSize,
      });

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: baseTokenPublicKey, isSigner: false, isWritable: true },
          { pubkey: quoteTokenPublicKey, isSigner: false, isWritable: true },
          // Add other necessary keys here
        ],
        programId: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        data: Buffer.from([]), // Add any necessary data here
      });

      return instruction;
    } catch (error) {
      console.error('Error creating liquidity pool:', error);
      return null;
    }
  }
  
  /**
   * Gets the instruction for creating a new pool, including validation
   * @returns Promise resolving to UiInstruction containing the serialized instruction
   */
  async function getInstruction(): Promise<UiInstruction> {
    console.log('Starting instruction validation and data fetching...');

    const isValid = await validateInstruction({ schema, form, setFormErrors });

    if (!isValid || !preCheckValidation()) {
      console.log('Validation failed or missing required data. Returning invalid instruction.');
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance ?? undefined };
    }

    try {
      const instruction = await createNewPoolInstruction();
      if (!instruction) {
        console.log('Failed to create pool instruction, returning invalid instruction');
        return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance ?? undefined };
      }

      const serializedInstruction = serializeInstructionToBase64(instruction);

      return { serializedInstruction, isValid: true, governance: form?.governedAccount?.governance ?? undefined };
    } catch (error) {
      console.error('Error during pool creation:', error);
      return { serializedInstruction: '', isValid: false, governance: form?.governedAccount?.governance ?? undefined };
    }
  }

  // Update instructions when governed account changes
  useEffect(() => {
    if (form.governedAccount && form.governedAccount.governance) {
      handleSetInstructions({
        governedAccount: form.governedAccount.governance,
        getInstruction: () => getInstruction(),
      }, index);
    }
  }, [form.governedAccount, handleSetInstructions, index]);

  // Form input configuration
  const inputs: InstructionInput[] = [
    { 
      label: 'Governance', 
      initialValue: form.governedAccount, 
      name: 'governedAccount', 
      type: InstructionInputType.GOVERNED_ACCOUNT, 
      shouldBeGoverned, 
      governance, 
      options: assetAccounts,
      placeholder: 'Select the governance account to associate with this instruction',
    },
    { 
      label: 'Base Token Mint', 
      initialValue: form.baseTokenMint, 
      name: 'baseTokenMint', 
      type: InstructionInputType.INPUT, 
    },
    { 
      label: 'Quote Token Mint', 
      initialValue: form.quoteTokenMint, 
      name: 'quoteTokenMint', 
      type: InstructionInputType.INPUT, 
    },
    { 
      label: 'Base Fee', 
      initialValue: form.baseFee, 
      name: 'baseFee', 
      type: InstructionInputType.INPUT, 
    },
    { 
      label: 'Bin Size', 
      initialValue: form.binSize, 
      name: 'binSize', 
      type: InstructionInputType.INPUT, 
    },
  ];

  return (
    <InstructionForm
      outerForm={form}
      setForm={setForm}
      inputs={inputs}
      formErrors={formErrors}
      setFormErrors={setFormErrors}
    />
  );
};

export default CreateDLMM;
