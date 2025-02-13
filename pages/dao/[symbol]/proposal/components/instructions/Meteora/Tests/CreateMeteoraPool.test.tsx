import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateLiquidityPool from '../CreateDLMM';
import { NewProposalContext } from '../../../../new';
import { Governance, ProgramAccount } from '@solana/spl-governance';
import { act } from 'react-dom/test-utils';
import { useWallet } from '@solana/wallet-adapter-react';

jest.mock('@solana/wallet-adapter-react', () => ({
  useWallet: jest.fn(),
  useConnection: () => ({ connection: { getParsedAccountInfo: jest.fn() } }),
}));

jest.mock('@hooks/useGovernanceAssets', () => () => ({
  assetAccounts: [],
}));

jest.mock('../../../../new', () => ({
  NewProposalContext: React.createContext({ handleSetInstructions: jest.fn() }),
}));

describe('CreateLiquidityPool Component', () => {
  let mockHandleSetInstructions: jest.Mock;

  beforeEach(() => {
    mockHandleSetInstructions = jest.fn();
    (useWallet as jest.Mock).mockReturnValue({ connected: true, publicKey: 'FakePublicKey' });
  });

  it('renders form inputs correctly', () => {
    render(
      <NewProposalContext.Provider value={{ handleSetInstructions: mockHandleSetInstructions, instructionsData: [], governance: null, setGovernance: jest.fn() }}>
        <CreateLiquidityPool index={0} governance={null} />
      </NewProposalContext.Provider>
    );

    expect(screen.getByLabelText(/Base Token Mint Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quote Token Mint Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quote Token Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base Token Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Config Address/i)).toBeInTheDocument();
  });

  it('updates form state on user input', async () => {
    render(
      <NewProposalContext.Provider value={{ handleSetInstructions: mockHandleSetInstructions, instructionsData: [], governance: null, setGovernance: jest.fn() }}>
        <CreateLiquidityPool index={0} governance={null} />
      </NewProposalContext.Provider>
    );

    const baseTokenInput = screen.getByLabelText(/Base Token Mint Address/i);
    
    act(() => {
      fireEvent.change(baseTokenInput, { target: { value: 'FakeTokenMintAddress' } });
    });

    expect(baseTokenInput).toHaveValue('FakeTokenMintAddress');
  });

  it('validates form correctly', async () => {
    render(
      <NewProposalContext.Provider value={{ handleSetInstructions: mockHandleSetInstructions, instructionsData: [], governance: null, setGovernance: jest.fn() }}>
        <CreateLiquidityPool index={0} governance={null} />
      </NewProposalContext.Provider>
    );

    const submitButton = screen.getByText(/Submit/i);
    
    act(() => {
      fireEvent.click(submitButton);
    });

    expect(await screen.findByText(/Base Token Mint Address is required/i)).toBeInTheDocument();
  });

  it('calls handleSetInstructions when governedAccount changes', async () => {
    render(
      <NewProposalContext.Provider value={{ handleSetInstructions: mockHandleSetInstructions, instructionsData: [], governance: null, setGovernance: jest.fn() }}>
        <CreateLiquidityPool index={0} governance={null} />
      </NewProposalContext.Provider>
    );

    act(() => {
      fireEvent.change(screen.getByLabelText(/Governance/i), { target: { value: 'FakeGovernance' } });
    });

    expect(mockHandleSetInstructions).toHaveBeenCalled();
  });
});
