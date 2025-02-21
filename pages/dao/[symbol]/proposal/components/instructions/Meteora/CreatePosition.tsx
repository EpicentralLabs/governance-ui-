/**
 * DLMMCreatePosition Component
 *
 * Handles the creation of a DLMM (Dynamic Liquidity Market Maker) position by gathering user input,
 * validating the data, and generating the necessary Solana instructions.
 * 
 * Developed by the Epicentral Team.
 * Contributors: @TheLazySol, @Tgcohce, @ZeroSums
 * Special thanks to @dberget
*/
import React, { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import BN from 'bn.js'
import {
  ProgramAccount,
  serializeInstructionToBase64,
  Governance,
} from '@solana/spl-governance'
import { validateInstruction } from '@utils/instructionTools'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
} from '@solana/web3.js'
import { NewProposalContext } from '../../../new'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import DLMM from '@meteora-ag/dlmm'
import { useConnection } from '@solana/wallet-adapter-react'
import { MeteoraCreatePositionForm } from '@utils/uiTypes/proposalCreationTypes'
const schema = yup.object().shape({
  governedAccount: yup.object().required('Governed account is required'),
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
  baseToken: yup.string().required('Base token is required'),
  baseTokenAmount: yup
    .number()
    .required('Base token amount is required')
    .min(0),
  quoteToken: yup.string().required('Quote token is required'),
  quoteTokenAmount: yup
    .number()
    .required('Quote token amount is required')
    .min(0),
  strategy: yup.object().required('Strategy is required'),
  minPrice: yup.number().required('Min price is required').min(0),
  maxPrice: yup.number().required('Max price is required').min(0),
  numBins: yup.number().required('Number of bins is required').min(1),
})

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
/**
 * CreatePosition Component
 * 
 * @param {Object} props - Component props
 * @param {number} props.index - Index of the instruction
 * @param {ProgramAccount<Governance> | null} props.governance - Governance account
 * @returns {JSX.Element}
 */
const CreatePosition = ({
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
    baseToken: '',
    baseTokenAmount: 0,
    quoteToken: '',
    quoteTokenAmount: 0,
    strategy: {
      name: 'Spot',
      value: 0,
    },
    minPrice: 0,
    maxPrice: 0,
    numBins: 69,
    autoFill: false,
    binStep: 0,
  })
 /**
   * Fetches the instruction for creating a DLMM position.
   * 
   * @returns {Promise<UiInstruction>} Serialized instruction and metadata.
   */
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
      // Get active bin and calculate range
      const activeBin = await dlmmPool.getActiveBin()

      // Calculate bin IDs based on prices
      let minBinId: number, maxBinId: number

      // Use binStep from form state instead of dlmmPool.state
      const binStep = dlmmPool?.lbPair?.binStep

      if (!binStep) {
        throw new Error('Bin step not available')
      }

      if (form.autoFill) {
        const TOTAL_RANGE_INTERVAL = 10
        minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL
        maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL
      } else {
        // Convert binStep from basis points to decimal
        // binStep is in basis points (e.g., 25 = 0.25%)
        const binStepDecimal = binStep / 10000

        // Calculate bin IDs using the correct formula
        // log_base(price) where base is (1 + binStepDecimal)
        minBinId = Math.floor(
          Math.log(form.minPrice) / Math.log(1 + binStepDecimal)
        )
        maxBinId = Math.ceil(
          Math.log(form.maxPrice) / Math.log(1 + binStepDecimal)
        )

        // Calculate and update number of bins based on price range
        const calculatedNumBins = maxBinId - minBinId + 1

        // Update form with calculated number of bins
        setForm((prev) => ({
          ...prev,
          numBins: calculatedNumBins,
        }))

        // Validate bin range
        if (calculatedNumBins > 69) {
          throw new Error(
            'Price range too large - exceeds maximum allowed bins (69)'
          )
        }
      }

      // Get actual prices from bin IDs for validation
      const minBinPrice = (1 + binStep / 10000) ** minBinId
      const maxBinPrice = (1 + binStep / 10000) ** maxBinId
      console.log(`Price Range: ${minBinPrice} - ${maxBinPrice}`)

      // Convert amounts to BN directly
      const totalXAmount = new BN(form.baseTokenAmount)
      const totalYAmount = new BN(form.quoteTokenAmount)

      // Generate position keypair
      const positionKeypair = Keypair.generate()

      // Create the position transaction
      const createPositionTx =
        await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          user: wallet?.publicKey,
          totalXAmount,
          slippage: 5,
          totalYAmount,
          strategy: {
            maxBinId,
            minBinId,
            strategyType: form.strategy.value,
          },
        })

      // Filter out compute budget program instructions, they get added later in the dryRun.
      const filteredInstructions = createPositionTx.instructions.filter(
        (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
      )

      createPositionTx.instructions = filteredInstructions

      const txArray = Array.isArray(createPositionTx)
        ? createPositionTx
        : [createPositionTx]
      if (txArray.length === 0) {
        throw new Error('No transactions returned by create position.')
      }

      const primaryInstructions = txArray[0].instructions
      if (primaryInstructions.length === 0) {
        throw new Error('No instructions in the create position transaction.')
      }
      // Add any remaining instructions as additional instructions
      const additionalSerializedInstructions = primaryInstructions.map(
        (instruction) => serializeInstructionToBase64(instruction),
      )

      return {
        serializedInstruction: '',
        additionalSerializedInstructions,
        isValid: true,
        governance: form?.governedAccount?.governance,
        signers: [positionKeypair],
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
        chunkBy: 1,
      }
    }
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
      initialValue: form.baseTokenAmount,
      name: 'baseTokenAmount',
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
      label: 'Quote Token Amount',
      initialValue: form.quoteTokenAmount,
      name: 'quoteTokenAmount',
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
      label: 'Number of Bins',
      initialValue: form.numBins,
      name: 'numBins',
      type: InstructionInputType.INPUT,
      inputType: 'number',
    },
    {
      label: 'Auto-Fill',
      initialValue: form.autoFill,
      name: 'autoFill',
      type: InstructionInputType.SWITCH,
    },
  ]

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index,
    )
  }, [form, handleSetInstructions, index])

  useEffect(() => {
`    TODO: Use  '@utils/Meteora/fetchPoolData' instead  `    
      const fetchPoolData = async () => {
      if (!form.dlmmPoolAddress) return
      
      try {
        const uri = `https://dlmm-api.meteora.ag/pair/${form.dlmmPoolAddress}`
        const response = await fetch(uri)
        if (!response.ok) throw new Error('Failed to fetch pool data')

        const data = await response.json()
        const parsePairs = (pairs: string) => {
          const [quoteToken, baseToken] = pairs
            .split('-')
            .map((pair: string) => pair.trim())
          return { quoteToken, baseToken }
        }
        const { quoteToken, baseToken } = parsePairs(data.name)
        const binStep = data.binStep // Get binStep from API response

        setForm((prevForm) => ({
          ...prevForm,
          baseToken,
          quoteToken,
          binStep, // Store binStep in form state
        }))

        console.log(
          `Updated pool data - baseToken: ${baseToken}, quoteToken: ${quoteToken}, binStep: ${binStep}`,
        )
      } catch (error) {
        console.error('Error fetching pool data:', error)
      }
    }

    fetchPoolData()
  }, [form.dlmmPoolAddress])

  return (
    <InstructionForm
      outerForm={form}
      setForm={setForm}
      inputs={inputs}
      setFormErrors={setFormErrors}
      formErrors={formErrors}
    />
  )
}

export default CreatePosition
