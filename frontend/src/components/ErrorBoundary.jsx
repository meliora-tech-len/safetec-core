import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page error caught by ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', padding: 40, gap: 16, color: 'var(--text-primary)',
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong on this page</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 420, textAlign: 'center' }}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
