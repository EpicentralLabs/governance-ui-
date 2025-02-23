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
import DLMM, { StrategyType, autoFillYByStrategy, autoFillXByStrategy } from '@meteora-ag/dlmm'

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


interface MeteoraCreatePositionForm {
  governedAccount: AssetAccount | undefined
  dlmmPoolAddress: string
  baseTokenAmount: number
  quoteTokenAmount: number
  strategy: {
    name: string
    value: StrategyType
  }
  autofill: boolean
  minPrice: number
  maxPrice: number
  slippage: number
  singleSidedX?: boolean
  singleSidedY?: boolean
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
    name: 'Spot Balanced',
    value: StrategyType.SpotBalanced,
    description: 'Provides a uniform distribution that is versatile and risk adjusted, suitable for any type of market and conditions.',
  },
  {
    name: 'Curve Balanced', 
    value: StrategyType.CurveBalanced,
    description: 'Creates a bell curve distribution centered around the current price, providing more liquidity near the middle.',
  },
  {
    name: 'Bid Ask Balanced',
    value: StrategyType.BidAskBalanced, 
    description: 'Concentrates liquidity at the bid and ask prices, good for range-bound markets.',
  },
  {
    name: 'Spot One Side',
    value: StrategyType.SpotOneSide,
    description: 'Uniform distribution on one side of the current price.',
  },
  {
    name: 'Curve One Side',
    value: StrategyType.CurveOneSide,
    description: 'Bell curve distribution on one side of the current price.',
  },
  {
    name: 'Bid Ask One Side',
    value: StrategyType.BidAskOneSide,
    description: 'Concentrated liquidity points on one side of the current price.',
  },
  {
    name: 'Spot ImBalanced',
    value: StrategyType.SpotImBalanced,
    description: 'Uniform but imbalanced distribution across the range.',
  },
  {
    name: 'Curve ImBalanced',
    value: StrategyType.CurveImBalanced,
    description: 'Bell curve with imbalanced distribution.',
  },
  {
    name: 'Bid Ask ImBalanced',
    value: StrategyType.BidAskImBalanced,
    description: 'Concentrated points with imbalanced distribution.',
  }
]

// Add utility function at the top of the file
const roundToDecimals = (value: number, decimals: 6): number => {
  const multiplier = Math.pow(10, decimals)
  return Math.round(value * multiplier) / multiplier
}

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
    autofill: true,
    strategy: {
      name: 'Spot Balanced',
      value: StrategyType.SpotBalanced,
    },
    minPrice: 0,
    maxPrice: 0,
    singleSidedX: false,
    singleSidedY: true,
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

      // Get bins between min and max price
      const binRange = await dlmmPool.getBinsBetweenMinAndMaxPrice(
        form.minPrice,
        form.maxPrice
      )

      // Get active bin for reference
      const activeBin = await dlmmPool.getActiveBin()
      const binStep = dlmmPool.lbPair.binStep

      if (!binStep) {
        throw new Error('Bin step not available')
      }

      // Validate price range
      if (form.minPrice >= form.maxPrice) {
        throw new Error('Min price must be less than max price')
      }

      // Use the bin range for position parameters
      const minBinId = binRange.bins[0]?.binId ?? activeBin.binId - 15
      const maxBinId = binRange.bins[binRange.bins.length - 1]?.binId ?? activeBin.binId + 15

      // Calculate amounts based on price range
      const totalXAmount = new BN(form.baseTokenAmount)
      const totalYAmount = new BN(form.quoteTokenAmount)

      // Generate position keypair
      const positionKeypair = Keypair.generate()
      console.log('Position keypair:', positionKeypair.publicKey.toBase58())

      const prerequisiteInstructions: TransactionInstruction[] = []
      console.log('Prerequisite instructions:', prerequisiteInstructions)

      const prerequisiteInstructionsSigners: Keypair[] = []
      console.log('Prerequisite instructions signers:', prerequisiteInstructionsSigners)


      // Add position keypair to signers
      prerequisiteInstructionsSigners.push(positionKeypair)
      console.log('Prerequisite instructions signers:', prerequisiteInstructionsSigners)

      // First create the position account
      prerequisiteInstructions.push(
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: positionKeypair.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(200), // Increased space for safety
          space: 200, // Increased space for safety
          programId: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
        })
      )
      console.log('Position keypair:', positionKeypair.publicKey.toBase58())

      // Create position with calculated parameters
      const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        user: wallet.publicKey,
        totalXAmount, // base token amount
        totalYAmount, // quote token amount
        slippage: form.slippage,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: form.strategy.value,
          singleSidedX: form.singleSidedX
        }
      })
      console.log('Create position transaction:', createPositionTx)

      // Filter and combine instructions
      const filteredInstructions: TransactionInstruction[] = [
        ...createPositionTx.instructions.filter(
          ix => !ix.programId.equals(ComputeBudgetProgram.programId)
        )
      ]

      if (filteredInstructions.length === 0) {
        throw new Error('No instructions returned by create position.')
      }
      console.log('Filtered instructions:', filteredInstructions)

      // Serialize all instructions
      const serializedInstructions = filteredInstructions.map(
        (instruction) => serializeInstructionToBase64(instruction),
      )
      console.log('Serialized instructions:', serializedInstructions)

      return {
        serializedInstruction: serializedInstructions[0],
        additionalSerializedInstructions: serializedInstructions.slice(1),
        governance: form?.governedAccount?.governance,
        prerequisiteInstructions,
        prerequisiteInstructionsSigners,
        isValid: true,
        chunkBy: 1,
      }


    } catch (err) {
      console.error('Error building create position instruction:', err)
      setFormErrors(prev => ({
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
      subtitle: 'Select the wallet that will manage and pay to open the position (0.06 SOL refundable upon closing the position)',
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
      additionalComponent: (
        <div className="text-sm text-neutral-500 mt-2">
          {strategyOptions.find(opt => opt.value === form.strategy.value)?.description}
        </div>
      )
    },
    // Conditionally show single-sided switch only for specific strategies
    ...(form.strategy.value === StrategyType.SpotOneSide ||
        form.strategy.value === StrategyType.CurveOneSide ||
        form.strategy.value === StrategyType.BidAskOneSide ? [
      {
        label: 'ENABLED: SELL-SIDE || DISABLED: BUY-SIDE',
        subtitle: 'ENABLED: Strategy will be single-sided for the base token (Sell-Side). || DISABLED: Strategy will be single-sided for the quote token (Buy-Side).',
        initialValue: form.singleSidedX,
        name: 'singleSidedX',
        type: InstructionInputType.SWITCH
      }
    ] : []),
    // Hide autofill for single-sided and imbalanced strategies
    ...(!(form.strategy.value === StrategyType.SpotOneSide ||
         form.strategy.value === StrategyType.CurveOneSide ||
         form.strategy.value === StrategyType.BidAskOneSide ||
         form.strategy.value === StrategyType.SpotImBalanced ||
         form.strategy.value === StrategyType.CurveImBalanced ||
         form.strategy.value === StrategyType.BidAskImBalanced) ? [
      {
        label: 'Autofill Base/Quote Token Amount?',
        subtitle: 'If enabled, the base and quote token amounts will be autocalculated based on the current pool price',
        initialValue: form.autofill,
        name: 'autofill',
        type: InstructionInputType.SWITCH,
        onChange: async (checked) => {
          if (!checked || !poolDetails) return

          try {
            // If either amount exists, calculate the other based on current pool price
            if (form.baseTokenAmount) {
              const quoteAmount = form.baseTokenAmount * poolDetails.current_price
              setForm(prev => ({
                ...prev,
                autofill: checked,
                quoteTokenAmount: roundToDecimals(quoteAmount, 6)
              }))
            } else if (form.quoteTokenAmount) {
              const baseAmount = form.quoteTokenAmount / poolDetails.current_price
              setForm(prev => ({
                ...prev,
                autofill: checked,
                baseTokenAmount: roundToDecimals(baseAmount, 6)
              }))
            }
          } catch (err) {
            console.error('Error in autofill:', err)
          }
        }
      }
    ] : []),
    {
      label: 'Base Token Amount (i.e. SOL)',
      initialValue: form.baseTokenAmount,
      name: 'baseTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      onChange: (value) => {
        const baseAmount = Number(value)
        if (isNaN(baseAmount)) return
        
        setForm(prev => ({
          ...prev,
          baseTokenAmount: baseAmount,
          ...(prev.autofill && poolDetails ? {
            quoteTokenAmount: roundToDecimals(baseAmount * poolDetails.current_price, 6)
          } : {})
        }))
      }
    },
    {
      label: 'Quote Token Amount (i.e. USDC)',
      initialValue: form.quoteTokenAmount,
      name: 'quoteTokenAmount',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      onChange: (value) => {
        const quoteAmount = Number(value)
        if (isNaN(quoteAmount)) return

        setForm(prev => ({
          ...prev,
          quoteTokenAmount: quoteAmount,
          ...(prev.autofill && poolDetails ? {
            baseTokenAmount: roundToDecimals(quoteAmount / poolDetails.current_price, 6)
          } : {})
        }))
      }
    },
    {
      label: 'Min Price',
      subtitle: 'Minimum price for the position range',
      initialValue: form.minPrice,
      name: 'minPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      additionalComponent: poolDetails ? (
        <div className="text-sm text-neutral-500">
          <p>Current market price: ${Number(poolDetails.current_price).toFixed(6)}</p>
          <p>Suggested min: ${(Number(poolDetails.current_price) * 0.9).toFixed(6)}</p>
        </div>
      ) : null,
      onChange: (value) => {
        const numValue = Number(value)
        if (!isNaN(numValue) && poolDetails) {
          // Ensure min price is not too far from current price
          const minAllowed = Number(poolDetails.current_price) * 0.8
          const maxAllowed = Number(poolDetails.current_price) * 1.2
          
          if (numValue < minAllowed || numValue > maxAllowed) {
            setFormErrors(prev => ({
              ...prev,
              minPrice: `Price should be between ${minAllowed.toFixed(6)} and ${maxAllowed.toFixed(6)}`
            }))
          } else {
            setFormErrors(prev => {
              const { minPrice, ...rest } = prev
              return rest
            })
          }
        }
        setForm(prev => ({ ...prev, minPrice: numValue }))
      }
    },
    {
      label: 'Max Price',
      subtitle: 'Maximum price for the position range',
      initialValue: form.maxPrice,
      name: 'maxPrice',
      type: InstructionInputType.INPUT,
      inputType: 'number',
      additionalComponent: poolDetails ? (
        <div className="text-sm text-neutral-500">
          <p>Current market price: ${Number(poolDetails.current_price).toFixed(6)}</p>
          <p>Suggested max: ${(Number(poolDetails.current_price) * 1.10).toFixed(6)}</p>
        </div>
      ) : null,
      onChange: (value) => {
        const numValue = Number(value)
        if (!isNaN(numValue) && poolDetails) {
          // Ensure max price is not too far from current price
          const minAllowed = Number(poolDetails.current_price) * 0.8
          const maxAllowed = Number(poolDetails.current_price) * 1.2
          
          if (numValue < minAllowed || numValue > maxAllowed) {
            setFormErrors(prev => ({
              ...prev,
              maxPrice: `Price should be between ${minAllowed.toFixed(6)} and ${maxAllowed.toFixed(6)}`
            }))
          } else {
            setFormErrors(prev => {
              const { maxPrice, ...rest } = prev
              return rest
            })
          }
        }
        setForm(prev => ({ ...prev, maxPrice: numValue }))
      }
    },
    {
      label: 'Slippage',
      subtitle: 'Enter the slippage tolerance for the position. Default is 2%',
      initialValue: form.slippage,
      name: 'slippage',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
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
        />
      )}
    </>
  )
}

export default DLMMCreatePosition
