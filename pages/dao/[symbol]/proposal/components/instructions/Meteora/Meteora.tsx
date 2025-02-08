import React, { useState, useContext } from 'react';
import { Connection } from '@solana/web3.js';
import { NewProposalContext } from '../../../new';
import GovernedAccountSelect from '../../GovernedAccountSelect';
import useGovernanceAssets from '@hooks/useGovernanceAssets';
import Input from '@components/inputs/Input';
import Select from '@components/inputs/Select';
import { CreateMeteoraPoolForm } from '@utils/uiTypes/proposalCreationTypes';
import { AssetAccount } from '@utils/uiTypes/assets';
export const METEORA_INSTRUCTIONS = {
  'M3mxk5W2tt27WGZWpZR7hUpV7c5Hqm8GfwUtbyLJGrj1': {
    1: {
      name: 'Create Liquidity Pool',
      accounts: [
        { name: 'Base Token' },
        { name: 'Quote Token' },
        { name: 'Pool Authority' },
        { name: 'Fee Account' },
        { name: 'Pool State' },
        { name: 'Token Program' },
      ],
      getDataUI: (connection: Connection) => {
        console.log('connection', connection);
        const { governance } = useContext(NewProposalContext);
        const { governedTokenAccountsWithoutNfts } = useGovernanceAssets();

        const [form, setForm] = useState<CreateMeteoraPoolForm>({
          governedTokenAccount: undefined,
          baseToken: '',
          quoteToken: 'SOL',
          authority: '',
          baseFee: '',
          fee: 0,
          binStep: '',
          initialPrice: '0.00',
        });

        const handleSetForm = (value: AssetAccount | any, propertyName: string) => {
          console.log('value', value);
          setForm((prev) => ({ ...prev, [propertyName]: value }));
        };

        return (
          <div className="space-y-4 p-4">
            <h2 className="text-lg font-semibold">Create Liquidity Pool</h2>

            <GovernedAccountSelect
              label="Select Source of Funds"
              governedAccounts={governedTokenAccountsWithoutNfts}
              onChange={(value: AssetAccount) => handleSetForm(value, 'governedTokenAccount')}
              value={form.governedTokenAccount}
              governance={governance}
              type="token"
            />

            <Select
              label="Base Token"
              value={form.baseToken}
              onChange={(value: any) => handleSetForm(value, 'baseToken')}
            >
              <option value="">Select Base Token</option>
              <option value="SOL">SOL</option>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
              <option value="Other">Other</option>
            </Select>

            <Select
              label="Quote Token"
              value={form.quoteToken}
              onChange={(value) => handleSetForm(value, 'quoteToken')}
            >
              <option value="SOL">SOL</option>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
            </Select>

            <Input
              label="Base Fee"
              type="number"
              value={form.baseFee}
              onChange={(e) => handleSetForm(e.target.value, 'baseFee')}
            />

            <Input
              label="Bin Step"
              type="number"
              value={form.binStep}
              onChange={(e) => handleSetForm(e.target.value, 'binStep')}
            />

            <Input
              label="Initial Price"
              type="number"
              step="0.01"
              value={form.initialPrice}
              onChange={(e) => handleSetForm(e.target.value, 'initialPrice')}
            />
          </div>
        );
      },
    },
  },
};
