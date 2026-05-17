import type { ButtonHTMLAttributes } from 'react'
import './Button.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={`ui-button ${className}`.trim()} {...props} />
  )
}
