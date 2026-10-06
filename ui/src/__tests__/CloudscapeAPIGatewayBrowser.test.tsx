import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 1,
      connection_type: 'local',
      writes_enabled: true,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const REST_ID = 'rest123'
const HTTP_ID = 'http456'

const statsPayload = {
  services: { apigateway: { status: 'available', resources: { rest_apis: 1, apis: 1 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const restApis = { items: [{ id: REST_ID, name: 'develop-coopanest-api' }] }
const httpApis = { items: [{ ApiId: HTTP_ID, Name: 'develop-api-gateway-internal' }] }

const tree = {
  resourceCount: 3,
  methodCount: 2,
  tree: [
    {
      id: 'root',
      parentId: null,
      path: '/',
      pathPart: '/',
      methods: [],
      children: [
        {
          id: 'res-apl',
          parentId: 'root',
          path: '/aplicacao',
          pathPart: 'aplicacao',
          methods: ['GET'],
          children: [],
        },
        {
          id: 'res-pdf',
          parentId: 'root',
          path: '/pdf',
          pathPart: 'pdf',
          methods: ['POST'],
          children: [],
        },
      ],
    },
  ],
}

const VTL = '#set($inputRoot = $input.params()) { "conexao": "abc" }'

const methodDetail = {
  method: {
    httpMethod: 'GET',
    authorizationType: 'NONE',
    apiKeyRequired: false,
    requestParameters: {},
    methodResponses: {
      '200': {
        statusCode: '200',
        responseParameters: { 'method.response.header.Access-Control-Allow-Origin': true },
        responseModels: { 'application/json': 'Empty' },
      },
    },
  },
  integration: {
    type: 'HTTP',
    httpMethod: 'GET',
    uri: 'https://${stageVariables.aplicacaoApiBaseUrl}/coopaapi/guia/index.php',
    timeoutInMillis: 29000,
    passthroughBehavior: 'WHEN_NO_MATCH',
    requestParameters: { 'integration.request.header.X-API-KEY': 'method.request.header.X-API-KEY' },
    requestTemplates: { 'application/json': VTL },
    integrationResponses: {
      '200': {
        statusCode: '200',
        selectionPattern: '',
        responseParameters: { 'method.response.header.Access-Control-Allow-Origin': "'*'" },
        responseTemplates: {},
      },
    },
  },
}

const routes = {
  routeCount: 2,
  tree: [
    {
      segment: '/v1',
      path: '/v1',
      methods: [],
      children: [
        {
      segment: '/usuarios',
      path: '/v1/usuarios',
      children: [],
      methods: [
        {
          routeId: 'r-any',
          method: 'ANY',
          routeKey: 'ANY /v1/usuarios',
          authorizationType: 'JWT',
          authorizerId: 'auth-1',
          target: 'integrations/int-1',
        },
        {
          routeId: 'r-opt',
          method: 'OPTIONS',
          routeKey: 'OPTIONS /v1/usuarios',
          authorizationType: 'NONE',
          authorizerId: null,
          target: 'integrations/int-1',
        },
      ],
        },
      ],
    },
  ],
}

const routeDetail = {
  route: { RouteId: 'r-any', RouteKey: 'ANY /v1/usuarios', AuthorizationType: 'JWT' },
  integration: { IntegrationId: 'int-1', IntegrationType: 'AWS_PROXY' },
  authorizer: { AuthorizerId: 'auth-1', Name: 'develop-authorizer' },
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/methods/')) payload = methodDetail
    else if (url.includes('/tree')) payload = tree
    else if (url.includes('/rest-apis')) payload = restApis
    else if (url.match(/\/routes\/[^/?]+/)) payload = routeDetail
    else if (url.includes('/routes')) payload = routes
    else if (url.includes('/apigateway/apis')) payload = httpApis
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderGateway(path = '/resources/apigateway') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

function abrir(path: string) {
  fireEvent.click(screen.getByRole('button', { name: `Expandir ${path}` }))
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeAPIGatewayBrowser (via registry dispatch)', () => {
  it('shows the resource tree of the first REST API', async () => {
    renderGateway()
    expect(await screen.findByText('/aplicacao')).toBeInTheDocument()
    expect(await screen.findByText('/pdf')).toBeInTheDocument()

    // Folha com metodos nasce recolhida e tem toggle proprio.
    expect(screen.queryByText('GET')).not.toBeInTheDocument()
    abrir('/aplicacao')
    expect(await screen.findByText('GET')).toBeInTheDocument()
  })

  it('asks the backend for the integration of the method that was clicked', async () => {
    renderGateway()
    await screen.findByText('/aplicacao')
    abrir('/aplicacao')
    fireEvent.click(await screen.findByText('GET'))

    expect(await screen.findByText('HTTP')).toBeInTheDocument()
    expect(await screen.findByText(/stageVariables.aplicacaoApiBaseUrl/)).toBeInTheDocument()
    expect(await screen.findByText('29000 ms')).toBeInTheDocument()

    const chamada = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('/methods/'))
    expect(chamada).toContain(`/apigateway/rest-apis/${REST_ID}/resources/res-apl/methods/GET`)
  })

  it('collapses a branch of the resource tree', async () => {
    renderGateway()
    expect(await screen.findByText('/aplicacao')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher /' }))
    expect(screen.queryByText('/aplicacao')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir /' }))
    expect(await screen.findByText('/aplicacao')).toBeInTheDocument()
  })

  it('shows the request header mapping and the VTL template', async () => {
    renderGateway()
    await screen.findByText('/aplicacao')
    abrir('/aplicacao')
    fireEvent.click(await screen.findByText('GET'))

    fireEvent.click(await screen.findByRole('tab', { name: 'Solicitacao de integracao' }))
    expect(await screen.findByText('integration.request.header.X-API-KEY')).toBeInTheDocument()
    expect(await screen.findByText('method.request.header.X-API-KEY')).toBeInTheDocument()
    expect(await screen.findByText(/\$input\.params\(\)/)).toBeInTheDocument()
  })

  it('shows the response mapping on both response tabs', async () => {
    renderGateway()
    await screen.findByText('/aplicacao')
    abrir('/aplicacao')
    fireEvent.click(await screen.findByText('GET'))

    fireEvent.click(await screen.findByRole('tab', { name: 'Resposta de integracao' }))
    expect(await screen.findByText('Status 200')).toBeInTheDocument()
    expect(await screen.findByText("'*'")).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('tab', { name: 'Resposta do metodo' }))
    expect(await screen.findByText('Empty')).toBeInTheDocument()
  })

  it('collapses a leaf that only has methods', async () => {
    renderGateway()
    await screen.findByText('/pdf')

    abrir('/pdf')
    expect(await screen.findByText('POST')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher /pdf' }))
    expect(screen.queryByText('POST')).not.toBeInTheDocument()
  })

  it('groups the HTTP routes by path and resolves the one that was clicked', async () => {
    renderGateway()
    fireEvent.click(await screen.findByRole('tab', { name: /HTTP/ }))

    // A arvore nasce com a raiz aberta; o segmento filho o usuario abre.
    expect(await screen.findByText('/v1')).toBeInTheDocument()
    abrir('/v1/usuarios')
    expect(await screen.findByText('/usuarios')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('ANY'))

    await waitFor(() => {
      const chamada = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes('/routes/r-any'))
      expect(chamada).toContain(`/apigateway/apis/${HTTP_ID}/routes/r-any`)
    })

    expect(await screen.findByText('auth-1')).toBeInTheDocument()
    // JWT aparece no resumo e de novo na aba de rota, entao findByText rejeitaria.
    expect((await screen.findAllByText('JWT')).length).toBeGreaterThan(0)
  })
})
