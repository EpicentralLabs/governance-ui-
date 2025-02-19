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
  Connection,
  ComputeBudgetProgram,
  SystemProgram,
} from '@solana/web3.js'
import { NewProposalContext } from '../../../new'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import DLMM from '@meteora-ag/dlmm'
import { toStrategyParameters } from '@meteora-ag/dlmm'
import { useConnection } from '@solana/wallet-adapter-react'
import { MeteoraCreatePositionForm } from '@utils/uiTypes/proposalCreationTypes'
import { StrategyParameters } from '@meteora-ag/dlmm'

const schema = yup.object().shape({
  governedAccount: yup.object().required('Governed account is required'),
  dlmmPoolAddress: yup.string().required('DLMM pool address is required'),
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
    baseToken: '',
    baseTokenAmount: 0,
    quoteToken: '',
    quoteTokenAmount: 0,
    strategy: {
      name: 'Spot',
      value: 0,
      description:
        'Provides a uniform distribution that is versatile and risk adjusted, suitable for any type of market and conditions. This is similar to setting a CLMM price range.',
    },
    minPrice: 0,
    maxPrice: 0,
    numBins: 69,
    autoFill: true,
    // positionPubkey: '',
    description: '',
    binStep: 0,
  })

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
      const binStep = form.binStep || dlmmPool?.lbPair?.binStep

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
      signers.push(positionKeypair)

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
          lamports: await connection.getMinimumBalanceForRentExemption(100),
          space: 100,
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
          slippage: 5,
          totalYAmount,
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

  useEffect(() => {
    const validatePriceRange = async () => {
      if (!form.dlmmPoolAddress || !form.minPrice || !form.maxPrice) return;

      try {
        const dlmmPoolPk = new PublicKey(form.dlmmPoolAddress);
        const dlmmPool = await DLMM.create(connection, dlmmPoolPk);
        const binStep = dlmmPool?.lbPair?.binStep;
        
        if (!binStep) return;

        // Convert prices to bin IDs
        const binStepDecimal = binStep / 10000;
        const minBinId = Math.floor(Math.log(form.minPrice) / Math.log(1 + binStepDecimal));
        const maxBinId = Math.ceil(Math.log(form.maxPrice) / Math.log(1 + binStepDecimal));
        
        // Calculate number of bins
        const numBins = maxBinId - minBinId + 1;
        
        // Update form with calculated bins
        setForm(prev => ({
          ...prev,
          numBins: numBins
        }));

        // Validate bin range
        if (numBins > 69) {
          setFormErrors(prev => ({
            ...prev,
            priceRange: 'Price range too large. Maximum 69 bins allowed.'
          }));
        }
      } catch (error) {
        console.error('Error validating price range:', error);
      }
    };

    validatePriceRange();
  }, [form.dlmmPoolAddress, form.minPrice, form.maxPrice, connection]);

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

export default DLMMCreatePosition
