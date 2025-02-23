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
  sendAndConfirmTransaction,
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

interface UiInstruction {
  serializedInstruction: string
  additionalSerializedInstructions?: string[]
  isValid: boolean
  governance: ProgramAccount<Governance> | undefined
  prerequisiteInstructions?: TransactionInstruction[]
  prerequisiteInstructionsSigners?: Keypair[]
  chunkBy?: number
}

// Add this interface for the API response
interface DLMMPoolApiResponse {
  name: string
  current_price: number
  bin_step: number
  base_fee_percentage: number
  max_fee_percentage: number
  fees_24h: number
  cumulative_fee_volume: number
  trade_volume_24h: number
  cumulative_trade_volume: number
  liquidity: number
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

  // Add state for pool details
  const [poolDetails, setPoolDetails] = useState<DLMMPoolApiResponse | null>(null)
  const [isLoadingPoolDetails, setIsLoadingPoolDetails] = useState(false)

  // Add function to fetch pool details
  const fetchPoolDetails = async (address: string) => {
    if (!address) return
    
    setIsLoadingPoolDetails(true)
    try {
      const response = await fetch(`https://dlmm-api.meteora.ag/pair/${address}`)
      if (!response.ok) throw new Error('Failed to fetch pool details')
      const data = await response.json()
      setPoolDetails(data)
    } catch (error) {
      console.error('Error fetching pool details:', error)
      setFormErrors(prev => ({
        ...prev,
        dlmmPoolAddress: 'Failed to fetch pool details'
      }))
    } finally {
      setIsLoadingPoolDetails(false)
    }
  }

  // Add effect to fetch pool details when address changes
  useEffect(() => {
    if (form.dlmmPoolAddress) {
      fetchPoolDetails(form.dlmmPoolAddress)
    } else {
      setPoolDetails(null)
    }
  }, [form.dlmmPoolAddress])

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
      const dlmmPoolAddress = new PublicKey(form.dlmmPoolAddress)
      const dlmmPool = await DLMM.create(connection, dlmmPoolAddress)
      // await dlmmPool.refetchStates()

      // Get active bin and calculate range
      const activeBin = await dlmmPool.getActiveBin();
      const binStep = dlmmPool?.lbPair?.binStep
      // Get active bin price per token
      const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
        Number(activeBin.price)
      );

      const totalXAmount = new BN(form.baseTokenAmount);
      const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

      if (!binStep) {
        throw new Error('Bin step not available')
      }

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

      const TOTAL_RANGE_INTERVAL = 15; // 15 bins on each side of the active bin
      const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
      const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

      // Create the position transaction
      const createPositionTx =
        await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          user: wallet?.publicKey,
          totalXAmount, // base token amount
          totalYAmount, // quote token amount
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
      // Add pool details display
      additionalComponent: isLoadingPoolDetails ? (
        <div className="text-sm text-neutral-500">Loading pool details...</div>
      ) : poolDetails ? (
        <div className="text-sm">
          <p><strong>Pool Name:</strong> {poolDetails.name}</p>
          <p><strong>Current Price:</strong> ${Number(poolDetails.current_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p><strong>Bin Step:</strong> {Number(poolDetails.bin_step).toLocaleString()}</p>
          <p><strong>Base Fee:</strong> {Number(poolDetails.base_fee_percentage).toFixed(2)}%</p>
          <p><strong>Max Fee:</strong> {Number(poolDetails.max_fee_percentage).toFixed(2)}%</p>
          <p><strong>Fees 24h:</strong> ${Number(poolDetails.fees_24h).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p><strong>Cumulative Fee Volume:</strong> ${Number(poolDetails.cumulative_fee_volume).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p><strong>Trade Volume 24h:</strong> ${Number(poolDetails.trade_volume_24h).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p><strong>Cumulative Trade Volume:</strong> ${Number(poolDetails.cumulative_trade_volume).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
          <p><strong>Liquidity:</strong> ${Number(poolDetails.liquidity).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
        </div>
      ) : null,
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
      onChange: (value) => {
        const baseAmount = Number(value)
        if (poolDetails && !isNaN(baseAmount)) {
          const quoteAmount = baseAmount * poolDetails.current_price
          setForm(prev => ({
            ...prev,
            baseTokenAmount: baseAmount,
            quoteTokenAmount: quoteAmount
          }))
        }
      }
    },
    {
      label: 'Quote Token Amount',
      initialValue: form.quoteTokenAmount,
      name: 'quoteTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      onChange: (value) => {
        const quoteAmount = Number(value)
        if (poolDetails && !isNaN(quoteAmount)) {
          const baseAmount = quoteAmount / poolDetails.current_price
          setForm(prev => ({
            ...prev,
            baseTokenAmount: baseAmount,
            quoteTokenAmount: quoteAmount
          }))
        }
      }
    },
    {
      label: 'Min Price',
      initialValue: form.minPrice,
      name: 'minPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      additionalComponent: isLoadingPoolDetails ? (
        <div className="text-sm text-neutral-500">Loading pool details...</div>
      ) : poolDetails ? (
        <div className="text-sm">
          <p>Current Base Token Price: ${Number(poolDetails.current_price).toFixed(2)}</p>
        </div>
      ) : null,
    },
    
    {
      label: 'Max Price',
      initialValue: form.maxPrice,
      name: 'maxPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      additionalComponent: isLoadingPoolDetails ? (
        <div className="text-sm text-neutral-500">Loading pool details...</div>
      ) : poolDetails ? (
        <div className="text-sm">
          <p>Current Quote Token Price: ${Number(poolDetails.current_price).toFixed(2)}</p>
        </div>
      ) : null,
    },
    {
      label: 'Slippage',
      subtitle: 'Enter the slippage tolerance for the position. Default is 2%',
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
