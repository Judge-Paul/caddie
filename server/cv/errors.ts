export class CvClassifyError extends Error {
  readonly status = 422

  constructor(message: string) {
    super(message)
    this.name = 'CvClassifyError'
  }
}
