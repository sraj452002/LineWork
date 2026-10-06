export const HELP = {
  graph:`title: Order system
group api "Backend" {
  svc [Orders | Go service] server
  db  [Orders DB | Postgres] database
}
web [Storefront] client

web > svc : HTTPS     arrow with label
svc <> db             two-way
svc -- db             plain line
web > svc > db        chain
svc > db, cache       fan-out

Architecture kinds: user client mobile api lb
server function database cache queue storage
cloud external service`,
  flowchart:`title: Refund request
start [Request refund] start
check [Within 30 days?] decision
form [Upload receipt] io
pay [Issue refund] step
done [Closed] end

start > check
check > form : yes
check > done : no
form > pay > done

Flowchart kinds: start end decision step io
Groups work as swimlanes.`,
  sequence:`title: Checkout
shop [Shopper] user
web [Web app] client
api [Payments API] api

shop > web : Place order
web > api : Charge card
api --> web : Approved      dashed reply
web > web : Render receipt   self call
note api : Retries twice
== Fulfillment ==            divider`,
  erd:`title: Blog
users {
  id uuid pk
  email text unique
}
posts {
  id uuid pk
  author_id uuid fk
  title text
}
posts.author_id > users.id   many-to-one
users < posts                one-to-many
users - profiles             one-to-one
posts <> tags                many-to-many`
};
