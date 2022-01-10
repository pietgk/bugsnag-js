import makeSafe from '../make-safe'

describe('delivery: react native makeSafe', () => {
  it('leaves simple types intact', () => {
    const data = {
      string: 'hello',
      number: -15.321,
      bool: true,
      date: new Date(),
      array: [
        1, 2, 3,
        'string',
        { nestedObject: true }
      ],
      nestedData: {
        string: 'hello',
        number: -15.321,
        bool: true
      }
    }

    const result = makeSafe(data)
    expect(result).toStrictEqual(result)
  })

  describe('handles errors', () => {
    it('when reading properties', () => {
      const object: any = {}
      Object.defineProperty(object, 'badProperty', {
        get () {
          throw new Error('failure')
        },
        enumerable: true
      })

      const result = makeSafe(object)
      expect(result).toStrictEqual({ badProperty: '[Throws: failure]' })
    })

    it('when they are properties', () => {
      const value = { errorProp: new Error('something wrong') }
      const result = makeSafe(value)
      expect(result).toStrictEqual({ errorProp: { name: 'Error', message: 'something wrong' } })
    })
  })

  describe('handles circular references', () => {
    it('when directly in objects', () => {
      const object: { self?: any } = {}
      object.self = object

      const result = makeSafe(object)
      expect(result).toStrictEqual({ self: '[Circular]' })
    })

    it('when nested in objects', () => {
      const outer: any = {
        inner: {}
      }

      outer.inner.parent = outer

      const result = makeSafe(outer)
      expect(result).toStrictEqual({ inner: { parent: '[Circular]' } })
    })

    it('when in arrays', () => {
      const array: any[] = [{}, {}]
      array[0].circularRef = array

      const result = makeSafe(array)
      expect(result).toStrictEqual([{ circularRef: '[Circular]' }, {}])
    })

    it('when in non-array iterables', () => {
      const object: any = {}
      const values = new Set()
      values.add(object)

      object.container = values

      const result = makeSafe(values)
      expect(result).toStrictEqual([{ container: '[Circular]' }])
    })
  })
})
