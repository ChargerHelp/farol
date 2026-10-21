export interface ButtonProps {
  label: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
}

export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button type="button" className={`button button--${variant}`} onClick={onClick}>
      {label}
    </button>
  )
}
