export class Server {
  ctx = {
    storage: {
      sql: {
        exec: () => ({
          toArray: () => []
        })
      }
    }
  };
  broadcast() {}
}
export function routePartykitRequest() {}
