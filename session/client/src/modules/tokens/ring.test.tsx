import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DISPOSITION_COLOR, ringColour } from './TokenRenderer';
import { TokenPortrait } from './TokenPortrait';
import { TokenTypeSheet } from './TokenTypeSheet';
import { BRAM, def, seat, sent, tokensState } from './playTestSeat';
import { seatColour } from '../../shell/seatColour';

afterEach(cleanup);

describe('the token ring', () => {
  it('draws its own colour, none for none, and the disposition when it has no ring', () => {
    expect(ringColour({ ring: '#be185d', disposition: 'hostile' })).toBe(0xbe185d);
    expect(ringColour({ ring: 'none', disposition: 'hostile' })).toBeNull();
    expect(ringColour({ disposition: 'friendly' })).toBe(DISPOSITION_COLOR.friendly);
    expect(ringColour({ ring: 'red', disposition: 'neutral' })).toBe(DISPOSITION_COLOR.neutral);
  });

  it('shows on the portrait the way it shows on the map', () => {
    render(<TokenPortrait name="Bram" assetId={null} ring="#be185d" />);
    expect(screen.getByText('BR').style.borderColor).toBe('rgb(190, 24, 93)');
  });
});

describe('Token type sheet picture', () => {
  it('opens the editor on the player seat colour and saves the ring with the type', async () => {
    const spy = seat({ tokens: tokensState([], [def({ id: 'd-bram', name: 'Bram', kind: 'pc', ownerIdentityId: BRAM.identityId, ownerName: BRAM.name })]) });
    render(<TokenTypeSheet defId="d-bram" />);
    fireEvent.click(screen.getByTestId('token-type-art'));
    const colour = seatColour(BRAM.identityId);
    expect(screen.getByTestId(`token-art-ring-${colour.slice(1)}`).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('token-art-save'));
    await waitFor(() => expect(screen.queryByTestId('token-art-editor')).toBeNull());
    fireEvent.click(screen.getByTestId('token-type-save'));
    expect(sent(spy)[0][2]).toMatchObject({ id: 'd-bram', ring: colour });
  });

  it('leaves a monster on its disposition ring when the ring is not touched', async () => {
    const spy = seat({ tokens: tokensState([], [def({ id: 'd-gob' })]) });
    render(<TokenTypeSheet defId="d-gob" />);
    fireEvent.click(screen.getByTestId('token-type-art'));
    fireEvent.click(screen.getByTestId('token-art-save'));
    await waitFor(() => expect(screen.queryByTestId('token-art-editor')).toBeNull());
    fireEvent.click(screen.getByTestId('token-type-save'));
    expect(sent(spy)[0][2]).not.toHaveProperty('ring');
  });
});
