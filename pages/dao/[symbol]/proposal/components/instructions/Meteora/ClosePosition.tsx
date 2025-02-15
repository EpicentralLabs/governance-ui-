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
  ComputeBudgetProgram,
} from '@solana/web3.js'
import { NewProposalContext } from '../../../new'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import DLMM from '@meteora-ag/dlmm'
import { useConnection } from '@solana/wallet-adapter-react'

interface MeteoraClosePositionForm {
  governedAccount?: any
  dlmmPoolAddress: string
  positionPubkey: string
}

// Validation schema with Yup
const schema = yup.object().shape({
  governedAccount: yup.object().required('Governed account is required'),
  dlmmPoolAddress: yup.string().required('DLMM pool address is required'),
  positionPubkey: yup.string().required('Position public key is required'),
})

const DLMMClosePosition = ({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) => {
  const { assetAccounts } = useGovernanceAssets()
  const wallet = useWalletOnePointOh()
  const { connection } = useConnection()
  const connected = !!wallet?.connected
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const { handleSetInstructions } = useContext(NewProposalContext)

  // If there is more than one instruction, keep the same governance
  const shouldBeGoverned = !!(index !== 0 && governance)

  const [form, setForm] = useState<MeteoraClosePositionForm>({
    governedAccount: undefined,
    dlmmPoolAddress: '',
    positionPubkey: '',
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

      // Get all positions, find the matching position
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
        wallet.publicKey
      )
      const userPosition = userPositions.find((pos) =>
        pos.publicKey.equals(new PublicKey(form.positionPubkey))
      )
      if (!userPosition) {
        throw new Error('Position not found for the given public key.')
      }

      // Gather bin IDs for the position
      const binIdsToRemove = userPosition.positionData.positionBinData.map(
        (bin) => bin.binId
      )

      // If your installed SDK method signature requires bps vs. an array:
      // remove 100% from all bins
      const removeLiquidityTx = await dlmmPool.removeLiquidity({
        position: userPosition.publicKey,
        user: wallet.publicKey,
        binIds: binIdsToRemove,
        bps: new BN(10000), // 100.00%
        shouldClaimAndClose: true,
      })

      const txArray = Array.isArray(removeLiquidityTx)
        ? removeLiquidityTx
        : [removeLiquidityTx]

      // Filter out any compute budget instructions
      const filteredIxs = txArray.flatMap((tx) =>
        tx.instructions.filter(
          (ix) => !ix.programId.equals(ComputeBudgetProgram.programId)
        )
      )

      if (!filteredIxs.length) {
        throw new Error('No valid instructions found to remove liquidity.')
      }

      // Convert to base64 for proposal
      const additionalSerializedInstructions = filteredIxs.map((instruction) =>
        serializeInstructionToBase64(instruction)
      )

      return {
        serializedInstruction: '',
        additionalSerializedInstructions,
        isValid: true,
        governance: form?.governedAccount?.governance,
        signers: [],
      }
    } catch (err) {
      console.error('Error building close position instruction:', err)
      setFormErrors((prev) => ({
        ...prev,
        general: 'Error building close position instruction: ' + (err as Error).message,
      }))
      return {
        serializedInstruction: '',
        isValid: false,
        governance: form?.governedAccount?.governance,
      }
    }
  }

  // The inputs for your form
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
      label: 'Position Public Key',
      initialValue: form.positionPubkey,
      name: 'positionPubkey',
      type: InstructionInputType.INPUT,
      inputType: 'text',
    },
  ]

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index
    )
  }, [form, handleSetInstructions, index])

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

export default DLMMClosePosition
