import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3StaticWebsiteOrigin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use an existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'CounterVpc', {
      vpcName: 'jenkins-vpc'
    });

    // Lookup existing Route 53 hosted zone for wovn-sandbox.com
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'wovn-sandbox.com',
    });

    // ✅ Request an ACM certificate for api.wovn-sandbox.com (API)
    const apiCertificate = new certificatemanager.Certificate(this, 'ALBCertificate', {
      domainName: 'api.wovn-sandbox.com',
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    // ✅ Request an ACM certificate for clickme.wovn-sandbox.com (Frontend)
    const frontendCertificate = new certificatemanager.DnsValidatedCertificate(this, 'FrontendCertificate', {
      domainName: 'clickme.wovn-sandbox.com',
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
      hostedZone,
      region: 'us-east-1', // 🔥 Must be in us-east-1 for CloudFront (?????????? WTF)
    });
    

    // Create a PostgreSQL RDS instance
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow PostgreSQL access from VPC');

    const dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      securityGroups: [dbSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      credentials: rds.Credentials.fromGeneratedSecret('postgres'), // Creates a secret in Secrets Manager
      databaseName: 'mydatabase',
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    ecsSecurityGroup.connections.allowTo(dbSecurityGroup, ec2.Port.tcp(5432), 'Allow ECS to connect to RDS');

    const cluster = new ecs.Cluster(this, 'CounterCluster', {
      vpc: vpc
    });

    // Define the Fargate service with HTTPS on ALB
    const fargateService = new ecspatterns.ApplicationLoadBalancedFargateService(this, 'CounterFargateService', {
      cluster: cluster,
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../back'),
        containerPort: 8080,
        environment: {
          DB_USER: 'postgres',
          DB_NAME: 'mydatabase',
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        secrets: {
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbInstance.secret!, 'password'),
        },      
      },
      publicLoadBalancer: true,
      certificate: apiCertificate, // Attach ACM certificate for API
      listenerPort: 443, // Enable HTTPS on ALB
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      minHealthyPercent: 100,
      maxHealthyPercent: 200
    });

    // Create a Route 53 A record for api.wovn-sandbox.com pointing to ALB
    new route53.ARecord(this, 'APIDNSRecord', {
      zone: hostedZone,
      recordName: 'api', // Creates api.wovn-sandbox.com
      target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(fargateService.loadBalancer)),
    });

    // ✅ Create an S3 bucket for the Vue.js frontend
    const siteBucket = new s3.Bucket(this, 'CounterSiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Grant public read access to the bucket
    siteBucket.grantPublicAccess('*', 's3:GetObject');

    // ✅ Create CloudFront distribution for the S3 bucket with custom domain
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      domainNames: ['clickme.wovn-sandbox.com'], // 🔥 Custom frontend domain
      certificate: frontendCertificate, // Attach SSL certificate for frontend
    });

    // ✅ Create a Route 53 record to map clickme.wovn-sandbox.com → CloudFront
    new route53.ARecord(this, 'FrontendDNSRecord', {
      zone: hostedZone,
      recordName: 'clickme', // Creates clickme.wovn-sandbox.com
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
    });

    // ✅ Create a CloudFront Origin using api.wovn-sandbox.com instead of ALB's AWS hostname
    const apiOrigin = new HttpOrigin('api.wovn-sandbox.com', {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY, // Use HTTPS
    });

    // ✅ Create a CloudFront Origin Request Policy for APIs
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    // ✅ Add behavior for /api/* to route to the ALB via api.wovn-sandbox.com
    distribution.addBehavior('/api/*', apiOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originRequestPolicy: apiOriginRequestPolicy,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    });

    // ✅ Output CloudFront and ALB DNS for reference
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: 'https://clickme.wovn-sandbox.com',
      description: 'The URL of the frontend app',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'The ID of the CloudFront distribution',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the API load balancer',
    });

    // display the psql instance endpoint
    new cdk.CfnOutput(this, 'DBEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
      description: 'The endpoint of the PostgreSQL RDS instance',
    });
  }
}
