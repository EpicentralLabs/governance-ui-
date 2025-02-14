import React, { useContext, useEffect, useState } from "react";
import * as yup from "yup";
import {
  Governance,
  ProgramAccount,
} from "@solana/spl-governance";
import { UiInstruction } from "@utils/uiTypes/proposalCreationTypes";
import { NewProposalContext } from "../../../new";
import InstructionForm, { InstructionInput } from "../FormCreator";
import { InstructionInputType } from "../inputInstructionType";
import { AssetAccount } from "@utils/uiTypes/assets";
import useGovernanceAssets from "@hooks/useGovernanceAssets";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import bs58 from "bs58";
import BN from "bn.js";

/**
 * Validates if a string is a valid base58 encoded value
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
 */
const CreateDLMM = ({
  index,
  governance,
}: {
  index: number;
  governance: ProgramAccount<Governance> | null;
}) => {
  const { assetAccounts } = useGovernanceAssets();
  const { connection } = useConnection();
  const { handleSetInstructions } = useContext(NewProposalContext);
  const shouldBeGoverned = !!(index !== 0 && governance);
  const validPairs: ProgramAccount<{
    binStep: number;
    baseFactor: number;
    filterPeriod: number;
    decayPeriod: number;
    reductionFactor: number;
    variableFeeControl: number;
    maxVolatilityAccumulator: number;
    minBinId: number;
    maxBinId: number;
    protocolShare: number;
  }>[] = [];
  
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<{
    governedAccount: AssetAccount | undefined;
    baseTokenMint: string;
    quoteTokenMint: string;
    baseFee: number;
    binSize: number;
  }>({
    governedAccount: undefined,
    baseTokenMint: "",
    quoteTokenMint: "",
    baseFee: 0,
    binSize: 0,
  });

  const schema = yup.object().shape({
    governedAccount: yup.object().nullable().required("Governed account is required"),
    baseTokenMint: yup.string().required("Base Token Mint is required"),
    quoteTokenMint: yup.string().required("Quote Token Mint is required"),
    baseFee: yup.number().required("Base Fee is required").min(0, "Base Fee must be non-negative"),
    binSize: yup.number().required("Bin Size is required").min(0, "Bin Size must be non-negative"),
  });

  const newPoolPosition = async (formData: {
    governedAccount: AssetAccount | undefined;
    baseTokenMint: string;
    quoteTokenMint: string;
    binSize: number;
    baseFee: number;
  }) => {
    try {
      console.log("Starting newPoolPosition with formData:", formData);
  
      if (!formData.governedAccount) {
        throw new Error("Governance account is required.");
      }
  
      const binStep = formData.binSize;
      const baseFee = formData.baseFee;
  
      const baseFactor = baseFee;
  
      console.log("Fetching preset parameters...");
      const presetParameters = await DLMM.getAllPresetParameters(connection) as unknown as ProgramAccount<{
        binStep: number;
        baseFactor: number;
        filterPeriod: number;
        decayPeriod: number;
        reductionFactor: number;
        variableFeeControl: number;
        maxVolatilityAccumulator: number;
        minBinId: number;
        maxBinId: number;
        protocolShare: number;
      }>[];
      console.log(`Fetched ${presetParameters.length} preset parameters.`);
      console.log("Available binSteps:", presetParameters.map(p => p.account.binStep));
      console.log("Available baseFactors:", presetParameters.map(p => p.account.baseFactor));
  
      // Log the values being used for filtering
      console.log("Form Data:", formData);
      console.log("binStep:", binStep, "baseFactor:", baseFactor);
  
      // Filter by binStep and baseFactor
      const presetParameterGroup = presetParameters.filter(p => p.account.binStep === binStep);
      console.log("Filtered by binStep:", presetParameterGroup);
  
      // Try to find a matching presetParameter
      const presetParameter = presetParameterGroup.find(p => p.account.baseFactor === baseFactor);
      console.log("Matching preset parameter:", presetParameter);
      presetParameters.forEach(p => {
        console.log(`binStep: ${p.account.binStep}, baseFactor: ${p.account.baseFactor}`);
      });
  
      if (presetParameterGroup.length === 0) {
        console.error(`No preset parameters found for binStep: ${binStep}`);
        throw new Error(`No preset parameters found for binStep: ${binStep}`);
      }
      
      presetParameters.forEach((p) => {
        const programAccount = p as ProgramAccount<{
          binStep: number;
          baseFactor: number;
          filterPeriod: number;
          decayPeriod: number;
          reductionFactor: number;
          variableFeeControl: number;
          maxVolatilityAccumulator: number;
          minBinId: number;
          maxBinId: number;
          protocolShare: number;
        }>;
      
        if (programAccount.account.binStep === binStep && programAccount.account.baseFactor === baseFactor) {
          validPairs.push(programAccount);
        }
      });
      
      // Log the first two valid pairs for debugging
      console.log("Valid pairs found:", validPairs.slice(0, 2));
  
      const lbPairKeypair = new Keypair();
      console.log("Generated new keypair for LB pair:", lbPairKeypair.publicKey.toBase58());
  
      console.log("Creating LB pair transaction...");
      const initPoolTx = await DLMM.createLbPair(
        connection,
        formData.governedAccount.pubkey,
        new PublicKey(formData.baseTokenMint),
        new PublicKey(formData.quoteTokenMint),
        new BN(binStep),
        new BN(baseFactor),
        presetParameter?.pubkey || new PublicKey("11111111111111111111111111111111"),
        new BN(0),
        { cluster: "mainnet-beta" }
      );
      console.log("Transaction size:", initPoolTx.serialize().length);
      console.log("Fetching latest blockhash...");
      const blockhash = await connection.getLatestBlockhash();
      console.log("Blockhash:", blockhash);
      initPoolTx.recentBlockhash = blockhash.blockhash;
      initPoolTx.feePayer = formData.governedAccount.pubkey;
  
      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1000000,
      });
      initPoolTx.add(computePriceIx);
      console.log("Added compute unit price instruction");
  
      const extraSigners = [lbPairKeypair];
      initPoolTx.sign(...extraSigners);
      console.log("Signed transaction with extra signers");
  
      const signature = await connection.sendTransaction(
        initPoolTx,
        extraSigners,
        { skipPreflight: true, maxRetries: 0, preflightCommitment: "confirmed" }
      );
  
      await connection.confirmTransaction(
        { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed"
      );
      console.log("Transaction signature:", signature);
  
      console.log("Confirming transaction...");
      await connection.confirmTransaction(
        { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed"
      );
      console.log("Transaction confirmed successfully");
  
      return {
        serializedInstruction: "Transaction completed successfully",
        isValid: true,
        governance: formData.governedAccount?.governance || undefined,
      };
    } catch (error) {
      console.error("Error creating pool position:", error);
      return {
        serializedInstruction: "",
        isValid: false,
        governance: formData.governedAccount?.governance || undefined,
      };
    }
  };
  

  useEffect(() => {
    console.log("useEffect triggered with form:", form);
    if (form?.governedAccount && form.governedAccount.governance) {
      handleSetInstructions(
        {
          governedAccount: form.governedAccount.governance,
          getInstruction: async () => await newPoolPosition(form),
        },
        index
      );
    }
  }, [form, handleSetInstructions, index]);

  const inputs: InstructionInput[] = [
    {
      label: "Governance",
      initialValue: form.governedAccount,
      name: "governedAccount",
      type: InstructionInputType.GOVERNED_ACCOUNT,
      shouldBeGoverned,
      governance,
      options: assetAccounts,
      placeholder: "Select the governance account to associate with this instruction",
    },
    {
      label: "Base Token Mint",
      initialValue: form.baseTokenMint,
      name: "baseTokenMint",
      type: InstructionInputType.INPUT,
    },
    {
      label: "Quote Token Mint",
      initialValue: form.quoteTokenMint,
      name: "quoteTokenMint",
      type: InstructionInputType.INPUT,
    },
    {
      label: "Base Fee",
      initialValue: form.baseFee,
      name: "baseFee",
      type: InstructionInputType.INPUT,
    },
    {
      label: "Bin Size",
      initialValue: form.binSize,
      name: "binSize",
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
