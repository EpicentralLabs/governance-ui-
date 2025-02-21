import React, { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import BN from 'bn.js'
import {
  ProgramAccount,
  serializeInstructionToBase64,
  Governance,
} from '@solana/spl-governance'
import { validateInstruction } from '@utils/instructionTools'
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

// SDK & Program Imports
import { toStrategyParameters } from '@meteora-ag/dlmm'
import DLMM from '@meteora-ag/dlmm'
import { BN as AnchorBN } from '@coral-xyz/anchor'

// Hooks
import { NewProposalContext } from '../../../new'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { useConnection } from '@solana/wallet-adapter-react'

// Components
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'

// Types
import { AssetAccount } from '@utils/uiTypes/assets'

interface MeteoraStrategy {
  name: string
  value: number
}

interface MeteoraCreatePositionForm {
  governedAccount: AssetAccount | undefined
  dlmmPoolAddress: string
  baseTokenAmount: number
  quoteTokenAmount: number
  strategy: MeteoraStrategy
  minPrice: number
  maxPrice: number
  slippage: number
  baseToken?: string
  quoteToken?: string
  binStep?: number
  numBins?: number
}

interface DLMMPair {
  address: string
  name: string
  baseToken: string
  quoteToken: string
  binStep: number
}

interface DLMMPairPool {
  address: string
  name: string
  dailyBaseApy: string
}

interface UiInstruction {
  serializedInstruction: string
  additionalSerializedInstructions?: string[]
  isValid: boolean
  governance: ProgramAccount<Governance> | undefined
  prerequisiteInstructions?: TransactionInstruction[]
  prerequisiteInstructionsSigners?: Keypair[]
  chunkBy?: number
}

// Validation Schema
const schema = yup.object().shape({
  governedAccount: yup.object().required('Governed account is required'),
  dlmmPoolAddress: yup.string().required('DLMM pool address is required'),
  baseTokenAmount: yup.number().required('Base token amount is required').min(0),
  quoteTokenAmount: yup.number().required('Quote token amount is required').min(0),
  strategy: yup.object().required('Strategy is required'),
  minPrice: yup.number().required('Min price is required').min(0),
  maxPrice: yup.number().required('Max price is required').min(0),
})

// Strategy Options
const strategyOptions = [
  {
    name: 'Spot',
    value: 6,
    description:
      'Provides a uniform distribution that is versatile and risk adjusted, suitable for any type of market and conditions. This is similar to setting a CLMM price range.',
  },
  { name: 'Curve', value: 7 },
  { name: 'Bid Ask', value: 8 },
]

// Main Component
const DLMMCreatePosition = ({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) => {
  const { assetAccounts } = useGovernanceAssets()
  const wallet = useWalletOnePointOh()
  const connected = !!wallet?.connected
  const { connection } = useConnection()
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const { handleSetInstructions } = useContext(NewProposalContext)
  const shouldBeGoverned = !!(index !== 0 && governance)

  const [form, setForm] = useState<MeteoraCreatePositionForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    baseTokenAmount: 0,
    quoteTokenAmount: 0,
    slippage: 2,
    strategy: {
      name: 'Spot',
      value: 6,
    },
    minPrice: 0,
    maxPrice: 0,
  })

  const [dlmmPairs, setDlmmPairs] = useState<DLMMPair[]>([])
  const [availablePools, setAvailablePools] = useState<DLMMPairPool[]>([])

  // Add loading states
  const [isLoadingPairs, setIsLoadingPairs] = useState(false)
  const [isLoadingPools, setIsLoadingPools] = useState(false)

  const getInstruction = async (): Promise<UiInstruction> => {
    const isValid = await validateInstruction({ schema, form, setFormErrors })
    if (
      !isValid ||
      !form?.governedAccount?.governance?.account ||
      !wallet?.publicKey ||
      !connected
    ) {
      return {
        serializedInstruction: '',
        isValid: false,
        governance: form?.governedAccount?.governance,
      }
    }

    try {
      const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress)
      const dlmmPool = await DLMM.create(connection, dlmmPoolPk)
      // await dlmmPool.refetchStates()

      // Get active bin and calculate range
      const activeBin = await dlmmPool.getActiveBin()

      // Calculate bin IDs based on prices
      const binStep = dlmmPool?.lbPair?.binStep

      if (!binStep) {
        throw new Error('Bin step not available')
      }

      // Convert binStep from basis points to decimal
      const binStepDecimal = binStep / 10000

      // Calculate bin IDs using the correct formula
      const minBinId = Math.floor(
        Math.log(form.minPrice) / Math.log(1 + binStepDecimal)
      )
      const maxBinId = Math.ceil(
        Math.log(form.maxPrice) / Math.log(1 + binStepDecimal)
      )

      // Get actual prices from bin IDs for validation
      const minBinPrice = (1 + binStepDecimal) ** minBinId
      const maxBinPrice = (1 + binStepDecimal) ** maxBinId
      console.log(`Price Range: ${minBinPrice} - ${maxBinPrice}`)

      // Convert amounts to BN directly
      const totalXAmount = new BN(form.baseTokenAmount)
      const totalYAmount = new BN(form.quoteTokenAmount)

      // Generate position keypair
      const signers: Keypair[] = []
      const positionKeypair = Keypair.generate()

      // Declare prerequisiteInstructions and filteredInstructions at the start
      const prerequisiteInstructions: any[] = []
      const filteredInstructions: any[] = []

      // Check if the account already exists
      const accountInfo = await connection.getAccountInfo(positionKeypair.publicKey)
      if (!accountInfo) {
        // Create account instruction
        const createAccountIx = SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: positionKeypair.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(128),
          space: 128,
          programId: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        })

        // Add the create account instruction to the prerequisite list
        prerequisiteInstructions.push(createAccountIx)
      }

      // Create the position transaction
      const createPositionTx =
        await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          user: wallet?.publicKey,
          totalXAmount,
          totalYAmount,
          slippage: form.slippage,
          strategy: {
            maxBinId,
            minBinId,
            strategyType: form.strategy.value,
          },
        })

      // Filter and combine instructions
      filteredInstructions.push(
        ...createPositionTx.instructions.filter(
          ix => !ix.programId.equals(ComputeBudgetProgram.programId)
        )
      )

      if (filteredInstructions.length === 0) {
        throw new Error('No instructions returned by create position.')
      }

      // Serialize all instructions
      const serializedInstructions = filteredInstructions.map(
        (instruction) => serializeInstructionToBase64(instruction),
      )

      return {
        // First instruction becomes the primary
        serializedInstruction: serializedInstructions[0],
        // Remaining instructions become additional
        additionalSerializedInstructions: serializedInstructions.slice(1),
        isValid: true,
        governance: form?.governedAccount?.governance,
        prerequisiteInstructions,
        prerequisiteInstructionsSigners: signers,
        chunkBy: 1,
      }
    } catch (err) {
      console.error('Error building create position instruction:', err)
      setFormErrors((prev) => ({
        ...prev,
        general: 'Error building create position instruction: ' + err.message,
      }))
      return {
        serializedInstruction: '',
        isValid: false,
        governance: form?.governedAccount?.governance,
      }
    }
  }

// INSUTRCTION FORM
  const inputs: InstructionInput[] = [
    {
      label: 'Governance Wallet',
      subtitle: 'Select the wallet that will manage the position',
      initialValue: form.governedAccount,
      name: 'governedAccount',
      type: InstructionInputType.GOVERNED_ACCOUNT,
      shouldBeGoverned: shouldBeGoverned as any,
      governance: governance,
      options: assetAccounts,
      assetType: 'wallet',
    },
    {
      label: 'DLMM Market Address',
      subtitle: 'Enter the address of the DLMM market you want to create a position in',
      initialValue: form.dlmmPoolAddress,
      name: 'dlmmPoolAddress',
      type: InstructionInputType.INPUT,
      inputType: 'text',
      
    },
    {
      label: 'Pair Pool Selection',
      initialValue: form.dlmmPoolAddress,
      name: 'dlmmPoolAddress',
      type: InstructionInputType.SELECT,
      inputType: 'select',
      options: isLoadingPools
        ? [{ value: '', label: 'Loading pool data...' }]
        : availablePools.map(pool => ({
            value: pool.address,
            label: `${pool.name} - Daily APY: ${Number(pool.dailyBaseApy).toFixed(2)}%`
          })),
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
      label: 'Base Token Amount',
      initialValue: form.baseTokenAmount,
      name: 'baseTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Quote Token Amount',
      initialValue: form.quoteTokenAmount,
      name: 'quoteTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Min Price',
      initialValue: form.minPrice,
      name: 'minPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Max Price',
      initialValue: form.maxPrice,
      name: 'maxPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Slippage',
      subtitle: 'Enter the slippage tolerance for the position. Default is 5%',
      initialValue: form.slippage,
      name: 'slippage',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    }
  ]

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index,
    )
  }, [form, handleSetInstructions, index])

  return (
    <>
      {form && (
        <InstructionForm
          outerForm={form}
          setForm={setForm}
          inputs={inputs}
          setFormErrors={setFormErrors}
          formErrors={formErrors}
        ></InstructionForm>
      )}
    </>
  )
}

export default DLMMCreatePosition
