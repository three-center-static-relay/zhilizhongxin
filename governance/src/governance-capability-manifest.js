import {buildManifest,makeCapability} from "./capability-abi.js";

const verified="2026-08-18T00:00:00.000Z";
const base={provider:"governance-worker",protocol:"service-binding",version:"1.0.0",auth_scope:"bearer-or-service-binding",network_scope:"cloudflare-service-bindings",write_scope:"none",license:"internal",jurisdiction:["global"],last_verified:verified,health:{status:"ready",checked_at:verified},reliability:{score:0.9,basis:"deterministic-contract-tests"},accuracy:{score:0.9,basis:"schema-validation"},trust:{level:"T0",status:"verified"}};

export function governanceCapabilityManifest(){
  const capabilities=[
    makeCapability({...base,id:"governance.constitution",type:"atomic",domain:"governance",operations:["policy.validate","authorization.boundary","budget.guard"],permission_scope:"read",input_schema:{type:"object",required:["operation"]},output_schema:{type:"object",required:["allowed"]},fitness:{quality:0.95,reliability:0.95,cost:1,latency:0.95,security:0.98,adaptability:0.5,complexity:0.2}}),
    makeCapability({...base,id:"governance.capability-genome",type:"composite",domain:"governance",operations:["capability.resolve","capability.validate","capability.ecology"],permission_scope:"read",dependencies:["governance.constitution"],fitness:{quality:0.85,reliability:0.9,cost:1,latency:0.9,security:0.95,adaptability:0.9,complexity:0.4}}),
    makeCapability({...base,id:"governance.context-compiler",type:"atomic",domain:"orchestration",operations:["context.compile","capability.retrieve","context.minimize"],permission_scope:"read",dependencies:["governance.capability-genome"],fitness:{quality:0.82,reliability:0.9,cost:1,latency:0.9,security:0.95,adaptability:0.9,complexity:0.35}}),
    makeCapability({...base,id:"governance.task-planner",type:"composite",domain:"orchestration",operations:["task.validate","task.plan","path.select"],permission_scope:"read",dependencies:["governance.context-compiler"],fitness:{quality:0.82,reliability:0.88,cost:1,latency:0.85,security:0.95,adaptability:0.9,complexity:0.4}}),
    makeCapability({...base,id:"governance.capability-composer",type:"composite",domain:"orchestration",operations:["graph.compose","fallback.resolve","gap.detect"],permission_scope:"read",dependencies:["governance.task-planner"],fitness:{quality:0.8,reliability:0.85,cost:1,latency:0.8,security:0.95,adaptability:0.92,complexity:0.45}}),
    makeCapability({...base,id:"governance.entropy-governor",type:"composite",domain:"governance",operations:["entropy.measure","redundancy.detect","prune.propose"],permission_scope:"read",dependencies:["governance.capability-genome"],fitness:{quality:0.78,reliability:0.88,cost:1,latency:0.85,security:0.98,adaptability:0.85,complexity:0.35}})
  ];
  const ecology=[
    {from:"governance.capability-genome",relation:"REQUIRES",to:"governance.constitution"},
    {from:"governance.task-planner",relation:"REQUIRES",to:"governance.context-compiler"},
    {from:"governance.capability-composer",relation:"REQUIRES",to:"governance.task-planner"},
    {from:"governance.entropy-governor",relation:"COMPLEMENTS",to:"governance.capability-genome"}
  ];
  return buildManifest("governance",capabilities,ecology);
}
