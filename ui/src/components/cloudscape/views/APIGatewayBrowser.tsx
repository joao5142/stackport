import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Grid from '@cloudscape-design/components/grid'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import {
  fetchHttpApis,
  fetchHttpRoute,
  fetchHttpRoutes,
  fetchRestApis,
  fetchRestApiTree,
  fetchRestMethod,
} from '@/lib/api'
import type {
  APIGatewayHttpApi,
  APIGatewayMethodDetail,
  APIGatewayRestApi,
  APIGatewayRouteDetail,
  APIGatewayRouteMethod,
  APIGatewayRouteNode,
  APIGatewayRoutesResponse,
  APIGatewayTreeNode,
  APIGatewayTreeResponse,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'

// Cores do console para o verbo HTTP: o olho acha o metodo antes de ler o path.
const METHOD_COLOR: Record<string, 'blue' | 'green' | 'red' | 'grey' | 'severity-medium'> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'severity-medium',
  PATCH: 'severity-medium',
  DELETE: 'red',
  ANY: 'grey',
  OPTIONS: 'grey',
  HEAD: 'grey',
}

type Mapa = Record<string, unknown>
type Par = { nome: string; valor: string }

function asMapa(v: unknown): Mapa {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Mapa) : {}
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'string') return v
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

function MethodBadge({ method }: { method: string }) {
  return <Badge color={METHOD_COLOR[method] ?? 'grey'}>{method}</Badge>
}

/** Mapa nome -> valor, como as tabelas de parametros e cabecalhos do console. */
function MapaTabela({
  titulo,
  colunaValor,
  data,
}: {
  titulo: string
  colunaValor: string
  data: unknown
}) {
  const items = useMemo<Par[]>(
    () => Object.entries(asMapa(data)).map(([nome, valor]) => ({ nome, valor: texto(valor) })),
    [data]
  )
  return (
    <Table
      variant="embedded"
      header={
        <Header variant="h3" counter={`(${items.length})`}>
          {titulo}
        </Header>
      }
      columnDefinitions={[
        { id: 'nome', header: 'Nome', cell: (i: Par) => i.nome },
        { id: 'valor', header: colunaValor, cell: (i: Par) => i.valor },
      ]}
      items={items}
      empty={<Box color="text-status-inactive">Nenhum</Box>}
    />
  )
}

/** Mapping template por content-type. E o que o fork do emulador avalia em VTL. */
function Templates({ titulo, data }: { titulo: string; data: unknown }) {
  const entries = Object.entries(asMapa(data))
  return (
    <SpaceBetween size="s">
      <Header variant="h3" counter={`(${entries.length})`}>
        {titulo}
      </Header>
      {entries.length === 0 && <Box color="text-status-inactive">Nenhum</Box>}
      {entries.map(([ct, tpl]) => (
        <Box key={ct}>
          <Box variant="awsui-key-label">{ct}</Box>
          <pre className="overflow-auto rounded bg-slate-100 p-3 text-xs dark:bg-slate-800">
            {texto(tpl)}
          </pre>
        </Box>
      ))}
    </SpaceBetween>
  )
}

/** Respostas por status, com os parametros e templates de cada uma. */
function Respostas({ data, comSelection }: { data: unknown; comSelection: boolean }) {
  const entries = Object.entries(asMapa(data))
  if (entries.length === 0) return <Box color="text-status-inactive">Nenhuma resposta definida</Box>
  return (
    <SpaceBetween size="l">
      {entries.map(([status, bruto]) => {
        const r = asMapa(bruto)
        return (
          <Container key={status} header={<Header variant="h3">Status {status}</Header>}>
            <SpaceBetween size="m">
              {comSelection && (
                <div>
                  <Box variant="awsui-key-label">Padrao de selecao</Box>
                  <Box>{r.selectionPattern ? texto(r.selectionPattern) : '(padrao)'}</Box>
                </div>
              )}
              <MapaTabela
                titulo="Cabecalhos de resposta"
                colunaValor="Mapeado de"
                data={r.responseParameters}
              />
              {'responseModels' in r && (
                <MapaTabela titulo="Modelos" colunaValor="Modelo" data={r.responseModels} />
              )}
              {'responseTemplates' in r && (
                <Templates titulo="Modelos de mapeamento" data={r.responseTemplates} />
              )}
            </SpaceBetween>
          </Container>
        )
      })}
    </SpaceBetween>
  )
}

// ---------------------------------------------------------------------------
// REST

function No({
  node,
  depth,
  abertos,
  alternar,
  selecionado,
  onSelect,
}: {
  node: APIGatewayTreeNode
  depth: number
  abertos: Set<string>
  alternar: (id: string) => void
  selecionado: string | null
  onSelect: (node: APIGatewayTreeNode, method: string) => void
}) {
  // Folha com metodos tambem recolhe: no console o toggle existe quando ha
  // qualquer coisa abaixo, seja sub-recurso ou metodo.
  const temConteudo = node.children.length > 0 || node.methods.length > 0
  const aberto = abertos.has(node.id)
  const rotulo = node.pathPart === '/' ? '/' : `/${node.pathPart}`

  return (
    <Box padding={{ left: depth === 0 ? 'n' : 'l' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {temConteudo ? (
          <Button
            variant="inline-icon"
            iconName={aberto ? 'treeview-collapse' : 'treeview-expand'}
            ariaLabel={`${aberto ? 'Recolher' : 'Expandir'} ${node.path}`}
            onClick={() => alternar(node.id)}
          />
        ) : (
          <span style={{ display: 'inline-block', width: 20 }} />
        )}
        <Box variant="awsui-key-label">{rotulo}</Box>
      </div>

      {aberto &&
        node.methods.map((m) => {
          const chave = `${node.id}:${m}`
          return (
            <Box key={chave} padding={{ left: 'xxl' }}>
              <span className="inline-flex cursor-pointer items-center rounded px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 [&_*]:!cursor-pointer">
                <Link
                  variant={selecionado === chave ? 'primary' : 'secondary'}
                  href="#"
                  onFollow={(e) => {
                    e.preventDefault()
                    onSelect(node, m)
                  }}
                >
                  <MethodBadge method={m} />
                </Link>
              </span>
            </Box>
          )
        })}

      {node.children.length > 0 &&
        aberto &&
        node.children.map((c) => (
          <No
            key={c.id}
            node={c}
            depth={depth + 1}
            abertos={abertos}
            alternar={alternar}
            selecionado={selecionado}
            onSelect={onSelect}
          />
        ))}
    </Box>
  )
}

function RestPanel({ apiId, endpoint }: { apiId: string; endpoint?: string | null }) {
  const [tree, setTree] = useState<APIGatewayTreeResponse | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<{ node: APIGatewayTreeNode; method: string } | null>(null)
  const [detail, setDetail] = useState<APIGatewayMethodDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    fetchRestApiTree(apiId, endpoint)
      .then((t) => {
        setTree(t)
        // A raiz nasce aberta, como no console; o resto o usuario abre.
        setAbertos(new Set(t.tree.map((n) => n.id)))
      })
      .catch((e) => setErro(String(e)))
  }, [apiId, endpoint])

  const alternar = useCallback((id: string) => {
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }, [])

  const selecionar = useCallback(
    (node: APIGatewayTreeNode, method: string) => {
      setSel({ node, method })
      setCarregando(true)
      setDetail(null)
      fetchRestMethod(apiId, node.id, method, endpoint)
        .then(setDetail)
        .catch((e) => setErro(String(e)))
        .finally(() => setCarregando(false))
    },
    [apiId, endpoint]
  )

  if (erro) return <Alert type="error">{erro}</Alert>
  if (!tree) return <Spinner />

  const metodo = asMapa(detail?.method)
  const integ = asMapa(detail?.integration)

  return (
    <Grid gridDefinition={[{ colspan: 4 }, { colspan: 8 }]}>
      <Container
        header={
          <Header
            variant="h3"
            counter={`(${tree.resourceCount} recursos, ${tree.methodCount} metodos)`}
          >
            Recursos
          </Header>
        }
      >
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          {tree.tree.map((n) => (
            <No
              key={n.id}
              node={n}
              depth={0}
              abertos={abertos}
              alternar={alternar}
              selecionado={sel ? `${sel.node.id}:${sel.method}` : null}
              onSelect={selecionar}
            />
          ))}
        </div>
      </Container>

      <Container
        header={
          <Header variant="h3">
            {sel ? `${sel.node.path} - ${sel.method}` : 'Selecione um metodo'}
          </Header>
        }
      >
        {!sel && <Box color="text-status-inactive">Escolha um metodo na arvore a esquerda.</Box>}
        {carregando && <Spinner />}
        {detail && (
          <SpaceBetween size="l">
            <ColumnLayout columns={2} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">ID do recurso</Box>
                <Box>{sel?.node.id}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Tipo de integracao</Box>
                <Box>{texto(integ.type)}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">URL do endpoint</Box>
                <Box>{texto(integ.uri)}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Tempo limite</Box>
                <Box>{integ.timeoutInMillis ? `${texto(integ.timeoutInMillis)} ms` : 'Padrao'}</Box>
              </div>
            </ColumnLayout>

            <Tabs
              tabs={[
                {
                  id: 'req-metodo',
                  label: 'Solicitacao de metodo',
                  content: (
                    <SpaceBetween size="m">
                      <ColumnLayout columns={2} variant="text-grid">
                        <div>
                          <Box variant="awsui-key-label">Autorizacao</Box>
                          <Box>{texto(metodo.authorizationType)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Chave de API obrigatoria</Box>
                          <Box>{metodo.apiKeyRequired ? 'Sim' : 'Falso'}</Box>
                        </div>
                      </ColumnLayout>
                      <MapaTabela
                        titulo="Parametros de solicitacao"
                        colunaValor="Obrigatorio"
                        data={metodo.requestParameters}
                      />
                      <MapaTabela
                        titulo="Modelos de solicitacao"
                        colunaValor="Modelo"
                        data={metodo.requestModels}
                      />
                    </SpaceBetween>
                  ),
                },
                {
                  id: 'req-integracao',
                  label: 'Solicitacao de integracao',
                  content: (
                    <SpaceBetween size="m">
                      <ColumnLayout columns={2} variant="text-grid">
                        <div>
                          <Box variant="awsui-key-label">Metodo HTTP da integracao</Box>
                          <Box>{texto(integ.httpMethod)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Passagem de entrada</Box>
                          <Box>{texto(integ.passthroughBehavior)}</Box>
                        </div>
                      </ColumnLayout>
                      <MapaTabela
                        titulo="Cabecalhos HTTP"
                        colunaValor="Mapeado de"
                        data={integ.requestParameters}
                      />
                      <Templates titulo="Modelos de mapeamento" data={integ.requestTemplates} />
                    </SpaceBetween>
                  ),
                },
                {
                  id: 'resp-integracao',
                  label: 'Resposta de integracao',
                  content: <Respostas data={integ.integrationResponses} comSelection />,
                },
                {
                  id: 'resp-metodo',
                  label: 'Resposta do metodo',
                  content: <Respostas data={metodo.methodResponses} comSelection={false} />,
                },
              ]}
            />
          </SpaceBetween>
        )}
      </Container>
    </Grid>
  )
}

// ---------------------------------------------------------------------------
// HTTP

function NoRota({
  node,
  depth,
  abertos,
  alternar,
  selecionado,
  onSelect,
}: {
  node: APIGatewayRouteNode
  depth: number
  abertos: Set<string>
  alternar: (path: string) => void
  selecionado: string | null
  onSelect: (m: APIGatewayRouteMethod) => void
}) {
  const temConteudo = node.children.length > 0 || node.methods.length > 0
  const aberto = abertos.has(node.path)

  return (
    <Box padding={{ left: depth === 0 ? 'n' : 'l' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {temConteudo ? (
          <Button
            variant="inline-icon"
            iconName={aberto ? 'treeview-collapse' : 'treeview-expand'}
            ariaLabel={`${aberto ? 'Recolher' : 'Expandir'} ${node.path}`}
            onClick={() => alternar(node.path)}
          />
        ) : (
          <span style={{ display: 'inline-block', width: 20 }} />
        )}
        <Box variant="awsui-key-label">{node.segment}</Box>
      </div>

      {aberto &&
        node.methods.map((m) => (
          <Box key={m.routeId} padding={{ left: 'xxl' }}>
            <span className="inline-flex cursor-pointer items-center rounded px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 [&_*]:!cursor-pointer">
              <Link
                variant={selecionado === m.routeId ? 'primary' : 'secondary'}
                href="#"
                onFollow={(e) => {
                  e.preventDefault()
                  onSelect(m)
                }}
              >
                <MethodBadge method={m.method} />
              </Link>
            </span>
          </Box>
        ))}

      {node.children.length > 0 &&
        aberto &&
        node.children.map((c) => (
          <NoRota
            key={c.path}
            node={c}
            depth={depth + 1}
            abertos={abertos}
            alternar={alternar}
            selecionado={selecionado}
            onSelect={onSelect}
          />
        ))}
    </Box>
  )
}

function HttpPanel({ apiId, endpoint }: { apiId: string; endpoint?: string | null }) {
  const [rotas, setRotas] = useState<APIGatewayRoutesResponse | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<APIGatewayRouteMethod | null>(null)
  const [detail, setDetail] = useState<APIGatewayRouteDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetchHttpRoutes(apiId, endpoint)
      .then((r) => {
        setRotas(r)
        setAbertos(new Set(r.tree.map((n) => n.path)))
      })
      .catch((e) => setErro(String(e)))
  }, [apiId, endpoint])

  const alternar = useCallback((path: string) => {
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (novo.has(path)) novo.delete(path)
      else novo.add(path)
      return novo
    })
  }, [])

  const selecionar = useCallback(
    (m: APIGatewayRouteMethod) => {
      setSel(m)
      setDetail(null)
      fetchHttpRoute(apiId, m.routeId, endpoint).then(setDetail).catch((e) => setErro(String(e)))
    },
    [apiId, endpoint]
  )

  if (erro) return <Alert type="error">{erro}</Alert>
  if (!rotas) return <Spinner />

  const integ = asMapa(detail?.integration)
  const autorizador = asMapa(detail?.authorizer)

  return (
    <Grid gridDefinition={[{ colspan: 4 }, { colspan: 8 }]}>
      <Container
        header={
          <Header variant="h3" counter={`(${rotas.routeCount})`}>
            Rotas
          </Header>
        }
      >
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          {rotas.tree.map((n) => (
            <NoRota
              key={n.path}
              node={n}
              depth={0}
              abertos={abertos}
              alternar={alternar}
              selecionado={sel?.routeId ?? null}
              onSelect={selecionar}
            />
          ))}
        </div>
      </Container>

      <Container header={<Header variant="h3">{sel ? sel.routeKey : 'Selecione uma rota'}</Header>}>
        {!sel && <Box color="text-status-inactive">Escolha uma rota na lista a esquerda.</Box>}
        {sel && !detail && <Spinner />}
        {detail && (
          <SpaceBetween size="l">
            <ColumnLayout columns={2} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">ID da rota</Box>
                <Box>{sel?.routeId}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Autorizacao</Box>
                <Box>{sel?.authorizationType ?? 'NONE'}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Autorizador</Box>
                <Box>{sel?.authorizerId ?? '-'}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Integracao</Box>
                <Box>{sel?.target ?? '-'}</Box>
              </div>
            </ColumnLayout>

            <Tabs
              tabs={[
                {
                  id: 'integracao',
                  label: 'Integracao',
                  content: (
                    <SpaceBetween size="m">
                      <ColumnLayout columns={2} variant="text-grid">
                        <div>
                          <Box variant="awsui-key-label">Tipo</Box>
                          <Box>{texto(integ.IntegrationType)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">URI</Box>
                          <Box>{texto(integ.IntegrationUri)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Formato do payload</Box>
                          <Box>{texto(integ.PayloadFormatVersion)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Metodo HTTP</Box>
                          <Box>{texto(integ.IntegrationMethod)}</Box>
                        </div>
                      </ColumnLayout>
                      <MapaTabela
                        titulo="Parametros de solicitacao"
                        colunaValor="Mapeado de"
                        data={integ.RequestParameters}
                      />
                    </SpaceBetween>
                  ),
                },
                {
                  id: 'autorizador',
                  label: 'Autorizador',
                  content: detail.authorizer ? (
                    <SpaceBetween size="m">
                      <ColumnLayout columns={2} variant="text-grid">
                        <div>
                          <Box variant="awsui-key-label">Nome</Box>
                          <Box>{texto(autorizador.Name)}</Box>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Tipo</Box>
                          <Box>{texto(autorizador.AuthorizerType)}</Box>
                        </div>
                      </ColumnLayout>
                      <MapaTabela
                        titulo="Configuracao JWT"
                        colunaValor="Valor"
                        data={autorizador.JwtConfiguration}
                      />
                    </SpaceBetween>
                  ) : (
                    <Box color="text-status-inactive">Rota sem autorizador</Box>
                  ),
                },
              ]}
            />
          </SpaceBetween>
        )}
      </Container>
    </Grid>
  )
}

// ---------------------------------------------------------------------------

export function CloudscapeAPIGatewayBrowser() {
  const { activeEndpoint: endpoint } = useEndpoint()
  const [restApis, setRestApis] = useState<APIGatewayRestApi[]>([])
  const [httpApis, setHttpApis] = useState<APIGatewayHttpApi[]>([])
  const [restSel, setRestSel] = useState<string | null>(null)
  const [httpSel, setHttpSel] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetchRestApis(endpoint)
      .then((r) => {
        setRestApis(r.items)
        setRestSel((atual) => atual ?? r.items[0]?.id ?? null)
      })
      .catch((e) => setErro(String(e)))
    fetchHttpApis(endpoint)
      .then((r) => {
        setHttpApis(r.items)
        setHttpSel((atual) => atual ?? r.items[0]?.ApiId ?? null)
      })
      .catch((e) => setErro(String(e)))
  }, [endpoint])

  if (erro) return <Alert type="error">{erro}</Alert>

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description="Recursos, metodos e rotas do endpoint selecionado">
        API Gateway
      </Header>

      <Tabs
        tabs={[
          {
            id: 'rest',
            label: `REST (${restApis.length})`,
            content: (
              <SpaceBetween size="m">
                <Select
                  selectedOption={
                    restSel
                      ? {
                          value: restSel,
                          label: restApis.find((a) => a.id === restSel)?.name ?? restSel,
                        }
                      : null
                  }
                  onChange={({ detail }) => setRestSel(detail.selectedOption.value ?? null)}
                  options={restApis.map((a) => ({ value: a.id, label: a.name ?? a.id }))}
                  placeholder="Selecione uma REST API"
                />
                {restSel ? (
                  <RestPanel key={restSel} apiId={restSel} endpoint={endpoint} />
                ) : (
                  <Box color="text-status-inactive">Nenhuma REST API neste endpoint.</Box>
                )}
              </SpaceBetween>
            ),
          },
          {
            id: 'http',
            label: `HTTP (${httpApis.length})`,
            content: (
              <SpaceBetween size="m">
                <Select
                  selectedOption={
                    httpSel
                      ? {
                          value: httpSel,
                          label: httpApis.find((a) => a.ApiId === httpSel)?.Name ?? httpSel,
                        }
                      : null
                  }
                  onChange={({ detail }) => setHttpSel(detail.selectedOption.value ?? null)}
                  options={httpApis.map((a) => ({ value: a.ApiId, label: a.Name ?? a.ApiId }))}
                  placeholder="Selecione uma HTTP API"
                />
                {httpSel ? (
                  <HttpPanel key={httpSel} apiId={httpSel} endpoint={endpoint} />
                ) : (
                  <Box color="text-status-inactive">Nenhuma HTTP API neste endpoint.</Box>
                )}
              </SpaceBetween>
            ),
          },
        ]}
      />
    </SpaceBetween>
  )
}
