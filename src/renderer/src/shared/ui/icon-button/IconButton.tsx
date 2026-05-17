import type { ButtonHTMLAttributes } from 'react'
import './IconButton.css'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export function IconButton({ className = '', ...props }: IconButtonProps) {
  return <button type="button" className={`icon-button ${className}`.trim()} {...props} />
}
