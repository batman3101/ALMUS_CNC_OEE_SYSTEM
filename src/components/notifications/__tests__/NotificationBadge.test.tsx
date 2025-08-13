import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationBadge } from '../NotificationBadge';

describe('NotificationBadge', () => {
  it('renders with correct count', () => {
    render(<NotificationBadge count={5} />);
    
    const badge = screen.getByText('5');
    expect(badge).toBeInTheDocument();
  });

  it('renders with correct severity color', () => {
    const { container } = render(
      <NotificationBadge count={3} severity="critical" />
    );
    
    const badge = container.querySelector('.ant-badge-count');
    expect(badge).toHaveStyle('background-color: rgb(255, 77, 79)'); // #ff4d4f
  });

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<NotificationBadge count={2} onClick={handleClick} />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders with small size', () => {
    const { container } = render(
      <NotificationBadge count={1} size="small" />
    );
    
    const button = container.querySelector('.ant-btn-sm');
    expect(button).toBeInTheDocument();
  });

  it('shows max count when count exceeds maxCount', () => {
    render(<NotificationBadge count={150} maxCount={99} />);
    
    const badge = screen.getByText('99+');
    expect(badge).toBeInTheDocument();
  });

  it('renders without count when count is 0', () => {
    const { container } = render(<NotificationBadge count={0} />);
    
    const badge = container.querySelector('.ant-badge-count');
    expect(badge).not.toBeInTheDocument();
  });
});