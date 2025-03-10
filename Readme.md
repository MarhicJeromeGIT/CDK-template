

--profile 567277437661_WovnioDeveloperSandboxEnvAccess


Hosted at [clickme.wovn-sandbox.com](https://clickme.wovn-sandbox.com)


```
[Route 53]
    |
    ├──> [CloudFront (clickme.wovn-sandbox.com)]  
    |         |
    |         ├──> [S3 Bucket (Vue.js Frontend)]
    |         |
    |         ├──> [CloudFront (API Proxy)]
    |                  |
    |                  ├──> [ALB (api.wovn-sandbox.com)]
    |                            |
    |                            ├──> [ECS Fargate (Backend API)]
    |
    ├──> [ACM Certificate (clickme.wovn-sandbox.com)] → Used by CloudFront
    └──> [ACM Certificate (api.wovn-sandbox.com)] → Used by ALB
```



Troubleshooting

```
CdkStack: fail: docker login (...) exited with error code 1: Error saving credentials: error storing credentials - err: exit status 1, out: `Docker credential command not supported without credential helper: store.`
```

cat ~/.docker/config.json
{
  "auths": {}
}
