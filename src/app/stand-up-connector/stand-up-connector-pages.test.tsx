import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StandUpConnectorPage from './page';
import StandUpConnectorPrivacyPage from './privacy/page';
import StandUpConnectorTermsPage from './terms/page';

describe('Stand Up connector public information', () => {
  it('describes the narrow Drive integration and links its public policies', () => {
    render(<StandUpConnectorPage />);

    expect(screen.getByRole('heading', { name: 'COL Haven Stand Up Connector' })).toBeInTheDocument();
    expect(screen.getByText(/one administrator-selected weekly Stand Up workbook/i)).toBeInTheDocument();
    expect(screen.getByText(/does not browse unrelated Drive files/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/stand-up-connector/privacy');
    expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/stand-up-connector/terms');
  });

  it('states exactly how Google user data is used, retained, and controlled', () => {
    render(<StandUpConnectorPrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Stand Up Connector Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/drive\.file/i)).toBeInTheDocument();
    expect(screen.getByText(/workbook bytes are processed transiently/i)).toBeInTheDocument();
    expect(screen.getByText(/not sold, used for advertising, or used to train/i)).toBeInTheDocument();
    expect(screen.getByText(/Google API Services User Data Policy/i)).toBeInTheDocument();
  });

  it('limits the connector to authorized operating use and human-reviewed conflicts', () => {
    render(<StandUpConnectorTermsPage />);

    expect(screen.getByRole('heading', { name: 'Stand Up Connector Terms of Use' })).toBeInTheDocument();
    expect(screen.getByText(/authorized Circle of Life operating personnel/i)).toBeInTheDocument();
    expect(screen.getByText(/never chooses a winner automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/does not replace clinical judgment/i)).toBeInTheDocument();
  });
});
