import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3StaticWebsiteOrigin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
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

    // Request an ACM certificate for api.wovn-sandbox.com
    const certificate = new certificatemanager.Certificate(this, 'ALBCertificate', {
      domainName: 'api.wovn-sandbox.com',
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    // Create an ECS cluster
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
      },
      publicLoadBalancer: true,
      certificate: certificate, // Attach ACM certificate
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

    // Create an S3 bucket for the Vue.js frontend
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

    // Create CloudFront distribution for the S3 bucket
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Create a CloudFront Origin using api.wovn-sandbox.com instead of ALB's AWS hostname
    const apiOrigin = new HttpOrigin('api.wovn-sandbox.com', {  // 🔥 Corrected usage
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY, // Use HTTPS
    });

    // Create a CloudFront Origin Request Policy for APIs
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    // Add behavior for /api/* to route to the ALB via api.wovn-sandbox.com
    distribution.addBehavior('/api/*', apiOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originRequestPolicy: apiOriginRequestPolicy,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    });

    // Output CloudFront and ALB DNS for reference
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
      description: 'The URL of the CloudFront distribution',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the load balancer',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'The ID of the CloudFront distribution',
    });
  }
}
